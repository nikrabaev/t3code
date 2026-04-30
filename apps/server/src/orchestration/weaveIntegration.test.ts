/**
 * End-to-end integration test: Weave Run with incremental planning completes.
 *
 * Drives a 2-Phase meta-plan flow through the full reactor stack:
 *  - Real OrchestrationEngine + WeaveEngine + WeaveScheduler + WeaveContractConformer + WeavePlanner
 *  - Stub PlannerDriver: returns the meta-Blueprint (2 Phases, 2 Planning Nodes, 0 Tasks)
 *  - Stub ProcessRunner: returns exit 0 for every verifier invocation
 *  - Stub GitCore: records createWorktree calls; returns fake paths
 *  - Smart turn driver: subscribes to thread.turn-start-requested. For each
 *    event, looks up the owning Weave node. If kind === "planning", injects an
 *    assistant message with the appropriate PhasePlannerOutput JSON. Then
 *    dispatches thread.session.set { status: "ready" } — the conformer's
 *    trigger event.
 *  - Approval driver: polls for run.status === "reviewing" and dispatches
 *    weave.blueprint.approve at the current version.
 *
 * Flow proven:
 *   create → meta-compile (v1) → approve v1
 *     → P1 planner dispatches → emits Tasks → blueprint-extend (v2) → reviewing
 *     → approve v2 → P1 Tasks verify
 *     → P2 planner dispatches (kind-stratified ready check) → emits Tasks
 *     → blueprint-extend (v3) → reviewing
 *     → approve v3 → P2 Tasks verify → run "complete"
 */
import {
  Blueprint,
  BlueprintVersion,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
  type WeaveRunProjection,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../config.ts";
import { GitCore, type GitCoreShape } from "../git/Services/GitCore.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusLive } from "./Layers/RuntimeReceiptBus.ts";
import { WeaveContractConformerLive } from "./Layers/WeaveContractConformer.ts";
import { WeaveEngineLive } from "./Layers/WeaveEngine.ts";
import { WeavePlannerLive } from "./Layers/WeavePlanner.ts";
import { WeaveSchedulerLive } from "./Layers/WeaveScheduler.ts";
import { PlannerDriver, PlannerDriverError } from "./Services/PlannerDriver.ts";
import {
  ProcessRunner,
  type ProcessRunnerShape,
  type ProcessRunnerResult,
} from "./Services/ProcessRunner.ts";
import { WeaveContractConformer } from "./Services/WeaveContractConformer.ts";
import { WeaveEngineService } from "./Services/WeaveEngine.ts";
import { WeaveScheduler } from "./Services/WeaveScheduler.ts";
import { WeavePlanner } from "./Services/WeavePlanner.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

const FAKE_WORKSPACE_ROOT = "/tmp/fake-workspace-e2e";

// ── 2-Phase meta-blueprint ───────────────────────────────────────────────────

function makeMetaBlueprintJson(): { rawJson: string } {
  const phase1Id = WeavePhaseId.make("phase-1");
  const phase2Id = WeavePhaseId.make("phase-2");
  const blueprint = Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: WeaveNodeId.make("phase-1-planner"),
        title: "Phase 1 Planner",
        description: "Plan Phase 1",
        kind: "planning",
        phaseId: phase1Id,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "PhasePlannerOutput JSON",
        dependsOn: [],
        status: "pending",
      },
      {
        id: WeaveNodeId.make("phase-2-planner"),
        title: "Phase 2 Planner",
        description: "Plan Phase 2",
        kind: "planning",
        phaseId: phase2Id,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "PhasePlannerOutput JSON",
        dependsOn: [],
        status: "pending",
      },
    ],
    phases: [
      {
        id: phase1Id,
        ordinal: 0,
        title: "Phase 1",
        description: "First Phase",
        approval: "pending",
      },
      {
        id: phase2Id,
        ordinal: 1,
        title: "Phase 2",
        description: "Second Phase",
        approval: "pending",
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: now(),
    compiledBy: "planner",
  });
  return { rawJson: JSON.stringify(Schema.encodeSync(Blueprint)(blueprint)) };
}

/**
 * The Phase-Planner JSON output for Phase 1: a single Task that depends on the
 * planner node. Note `kind: "raw"` (not `"planning"` — Slice 3 forbids
 * recursion); `phaseId: "phase-1"` (must equal the planner's phase).
 */
function phase1PlannerOutput(): string {
  return JSON.stringify({
    addedNodes: [
      {
        id: "phase-1-task-1",
        title: "Phase 1 Task",
        description: "First task in Phase 1",
        kind: "raw",
        phaseId: "phase-1",
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: ["phase-1-planner"],
        status: "pending",
      },
    ],
  });
}

function phase2PlannerOutput(): string {
  return JSON.stringify({
    addedNodes: [
      {
        id: "phase-2-task-1",
        title: "Phase 2 Task",
        description: "First task in Phase 2",
        kind: "raw",
        phaseId: "phase-2",
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: ["phase-2-planner"],
        status: "pending",
      },
    ],
  });
}

// ── Stub PlannerDriver ────────────────────────────────────────────────────────

function makeStubPlannerDriver(outputs: ReadonlyArray<string | Error>): Layer.Layer<PlannerDriver> {
  let callIndex = 0;
  return Layer.succeed(
    PlannerDriver,
    PlannerDriver.of({
      compile: (_input) => {
        const idx = callIndex++;
        const output = outputs[idx];
        if (output === undefined) {
          return Effect.fail(
            new PlannerDriverError({ reason: "stub: no more outputs configured" }),
          );
        }
        if (output instanceof Error) {
          return Effect.fail(new PlannerDriverError({ reason: output.message }));
        }
        return Effect.succeed(output);
      },
    }),
  );
}

// ── Stub ProcessRunner ────────────────────────────────────────────────────────

function makeStubProcessRunner(result: ProcessRunnerResult) {
  let runCount = 0;
  const stubShape: ProcessRunnerShape = {
    run: (_input) => {
      runCount++;
      return Effect.succeed(result);
    },
  };
  return {
    layer: Layer.succeed(ProcessRunner, ProcessRunner.of(stubShape)),
    getRunCount: () => runCount,
  };
}

// ── Stub GitCore ──────────────────────────────────────────────────────────────

function makeStubGitCore() {
  const worktreeCalls: string[] = [];
  const stubShape: GitCoreShape = {
    createWorktree: (input) => {
      const branch = input.newBranch ?? input.branch;
      worktreeCalls.push(branch);
      return Effect.succeed({
        worktree: { path: `/tmp/weave-test-${branch}`, branch },
      });
    },
    execute: () => Effect.die(new Error("stub: execute not implemented")),
    status: () => Effect.die(new Error("stub: status not implemented")),
    statusDetails: () => Effect.die(new Error("stub: statusDetails not implemented")),
    statusDetailsLocal: () => Effect.die(new Error("stub: statusDetailsLocal not implemented")),
    prepareCommitContext: () => Effect.die(new Error("stub: prepareCommitContext not implemented")),
    commit: () => Effect.die(new Error("stub: commit not implemented")),
    pushCurrentBranch: () => Effect.die(new Error("stub: pushCurrentBranch not implemented")),
    readRangeContext: () => Effect.die(new Error("stub: readRangeContext not implemented")),
    readConfigValue: () => Effect.die(new Error("stub: readConfigValue not implemented")),
    isInsideWorkTree: () => Effect.die(new Error("stub: isInsideWorkTree not implemented")),
    listWorkspaceFiles: () => Effect.die(new Error("stub: listWorkspaceFiles not implemented")),
    filterIgnoredPaths: () => Effect.die(new Error("stub: filterIgnoredPaths not implemented")),
    listBranches: () => Effect.die(new Error("stub: listBranches not implemented")),
    pullCurrentBranch: () => Effect.die(new Error("stub: pullCurrentBranch not implemented")),
    fetchPullRequestBranch: () =>
      Effect.die(new Error("stub: fetchPullRequestBranch not implemented")),
    ensureRemote: () => Effect.die(new Error("stub: ensureRemote not implemented")),
    fetchRemoteBranch: () => Effect.die(new Error("stub: fetchRemoteBranch not implemented")),
    setBranchUpstream: () => Effect.die(new Error("stub: setBranchUpstream not implemented")),
    removeWorktree: () => Effect.die(new Error("stub: removeWorktree not implemented")),
    renameBranch: () => Effect.die(new Error("stub: renameBranch not implemented")),
    createBranch: () => Effect.die(new Error("stub: createBranch not implemented")),
    checkoutBranch: () => Effect.die(new Error("stub: checkoutBranch not implemented")),
    initRepo: () => Effect.die(new Error("stub: initRepo not implemented")),
    listLocalBranchNames: () => Effect.die(new Error("stub: listLocalBranchNames not implemented")),
  };
  return {
    layer: Layer.succeed(GitCore, GitCore.of(stubShape)),
    worktreeCalls,
  };
}

// ── System factory ────────────────────────────────────────────────────────────

async function createE2ESystem(testPrefix: string) {
  const { rawJson } = makeMetaBlueprintJson();
  const stubPlannerDriverLayer = makeStubPlannerDriver([rawJson]);
  const stubProcessRunner = makeStubProcessRunner({
    exitCode: 0,
    stdout: "All tests passed\n",
    stderr: "",
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  const stubGit = makeStubGitCore();

  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), { prefix: testPrefix });

  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolverLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const weaveEngineLayer = WeaveEngineLive.pipe(Layer.provide(orchestrationLayer));
  const receiptBusLayer = RuntimeReceiptBusLive;

  const plannerLayer = WeavePlannerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubPlannerDriverLayer),
  );

  const schedulerLayer = WeaveSchedulerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubGit.layer),
  );

  const conformerLayer = WeaveContractConformerLive.pipe(
    Layer.provide(receiptBusLayer),
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubProcessRunner.layer),
  );

  const appLayer = conformerLayer.pipe(
    Layer.provideMerge(schedulerLayer),
    Layer.provideMerge(plannerLayer),
    Layer.provideMerge(receiptBusLayer),
    Layer.provideMerge(weaveEngineLayer),
    Layer.provideMerge(orchestrationLayer),
  );

  const runtime = ManagedRuntime.make(appLayer);
  const services = await runtime.runPromise(
    Effect.gen(function* () {
      return {
        conformer: yield* WeaveContractConformer,
        scheduler: yield* WeaveScheduler,
        planner: yield* WeavePlanner,
        weaveEngine: yield* WeaveEngineService,
        orchestrationEngine: yield* OrchestrationEngineService,
      };
    }),
  );

  return {
    ...services,
    stubProcessRunner,
    stubGit,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

// ── Smart turn driver ────────────────────────────────────────────────────────

/**
 * For each thread.turn-start-requested:
 *  - Look up the owning Weave node from the projection.
 *  - If the node is `kind: "planning"`, find its planner output in the map
 *    and append an assistant message with that JSON.
 *  - Then dispatch `thread.session.set { status: "ready", activeTurnId: null }`
 *    — the conformer's trigger event.
 *
 * The `plannerOutputs` map keys by node id; the value is the JSON string the
 * Phase Planner agent would emit. For a Task node the key is omitted (no
 * injection needed).
 */
function startSmartTurnDriver(
  system: Awaited<ReturnType<typeof createE2ESystem>>,
  plannerOutputs: ReadonlyMap<string, string>,
  weaveRunId: WeaveRunId,
) {
  return Effect.forkScoped(
    Stream.runForEach(
      system.orchestrationEngine.streamDomainEvents.pipe(
        Stream.filter(
          (e): e is Extract<typeof e, { type: "thread.turn-start-requested" }> =>
            e.type === "thread.turn-start-requested",
        ),
      ),
      (event) =>
        Effect.gen(function* () {
          const threadId = event.payload.threadId;
          // Reverse-lookup: find the owning Weave node by walking childThreads.
          const projection = yield* system.weaveEngine.getWeaveRun(weaveRunId);
          if (projection === null) return;
          const ownerNodeId = findOwningNode(projection, threadId);
          if (ownerNodeId === null) return;

          const plannerJson = plannerOutputs.get(ownerNodeId);
          if (plannerJson !== undefined) {
            yield* system.orchestrationEngine.appendSystemEvent({
              eventId: EventId.make(crypto.randomUUID()),
              aggregateKind: "thread",
              aggregateId: threadId,
              type: "thread.message-sent",
              occurredAt: now(),
              commandId: null,
              causationEventId: null,
              correlationId: null,
              metadata: {},
              payload: {
                threadId,
                messageId: MessageId.make(`msg-${crypto.randomUUID()}`),
                role: "assistant",
                text: plannerJson,
                turnId: null,
                streaming: false,
                createdAt: now(),
                updatedAt: now(),
              },
            });
          }

          // Dispatch session.set with status "ready" — the conformer's
          // trigger event.
          yield* system.orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`cmd-session-set-${crypto.randomUUID()}`),
            threadId,
            session: {
              threadId,
              status: "ready",
              providerName: "stub",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: now(),
            },
            createdAt: now(),
          });
        }),
    ),
  );
}

function findOwningNode(projection: WeaveRunProjection, threadId: ThreadId): string | null {
  for (const [nodeId, entry] of projection.childThreads) {
    if (entry.threadId === threadId) return nodeId as string;
  }
  return null;
}

// ── Approval driver ──────────────────────────────────────────────────────────

/**
 * Polls for run.status === "reviewing"; when found, dispatches
 * weave.blueprint.approve at the current Blueprint version. Stops when the
 * run is terminal (complete / aborted).
 */
function startApprovalDriver(
  system: Awaited<ReturnType<typeof createE2ESystem>>,
  weaveRunId: WeaveRunId,
  approvedVersions: { current: Set<number> },
) {
  return Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep("30 millis");
        const projection = yield* system.weaveEngine.getWeaveRun(weaveRunId);
        if (projection === null) continue;
        const status = projection.run.status;
        if (status === "complete" || status === "aborted") return;
        if (status !== "reviewing") continue;
        const version = projection.currentBlueprint?.version;
        if (version === undefined) continue;
        if (approvedVersions.current.has(version as number)) continue;
        approvedVersions.current.add(version as number);
        yield* system.weaveEngine.dispatchWeaveCommand({
          type: "weave.blueprint.approve",
          commandId: CommandId.make(`cmd-approve-${version}-${crypto.randomUUID()}`),
          weaveRunId,
          blueprintVersion: version,
          concurrencyCap: 1,
          createdAt: now(),
        });
      }
    }),
  );
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe("Weave Run end-to-end (incremental planning)", () => {
  it("completes a 2-Phase meta-plan run from create to complete", async () => {
    const projectId = "project-e2e-1";
    const runId = WeaveRunId.make("run-e2e-1");

    const system = await createE2ESystem("t3-weave-e2e-incremental-1-");

    const plannerOutputs = new Map<string, string>([
      ["phase-1-planner", phase1PlannerOutput()],
      ["phase-2-planner", phase2PlannerOutput()],
    ]);
    const approvedVersions = { current: new Set<number>() };

    const projection = await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          // Start all reactors.
          yield* system.planner.start();
          yield* system.scheduler.start();
          yield* system.conformer.start();
          yield* Effect.sleep("30 millis"); // let subscribers attach

          // Seed project.
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: ProjectId.make(projectId),
            title: "E2E Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });

          // Start the smart turn driver and approval driver.
          yield* startSmartTurnDriver(system, plannerOutputs, runId);
          yield* startApprovalDriver(system, runId, approvedVersions);

          // Create the Weave Run. Planner reactor calls the stub driver and
          // emits weave.blueprint-compiled (v1, initial) → run goes to
          // "reviewing". Approval driver picks it up and approves v1 → run
          // goes to "running". Scheduler dispatches Phase 1's Planning Node.
          // Smart turn driver injects Phase 1's planner output and dispatches
          // session.ready. Conformer reads JSON, dispatches
          // weave.blueprint.extend. Decider emits node-verified + extended +
          // compiled (v2, phase-planning) → reviewing. Approval driver
          // approves v2 → running. Scheduler dispatches Phase 1 Task. Smart
          // turn driver dispatches session.ready (no JSON injection — Task).
          // Conformer runs verifier (stub exit 0) → node-verified. Phase 1
          // complete → scheduler dispatches Phase 2's Planning Node. … and so
          // on until run "complete".
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-e2e-create"),
            weaveRunId: runId,
            projectId: ProjectId.make(projectId),
            title: "Incremental Planning E2E",
            vision: "Build something across two phases",
            createdAt: now(),
          });

          // Poll for "complete".
          const deadline = Date.now() + 30_000;
          let delay = 30;
          while (Date.now() < deadline) {
            const p = yield* system.weaveEngine.getWeaveRun(runId);
            if (p?.run.status === "complete") break;
            yield* Effect.sleep(`${delay} millis`);
            delay = Math.min(Math.round(delay * 1.5), 500);
          }

          return yield* system.weaveEngine.getWeaveRun(runId);
        }),
      ),
    );

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("complete");

    // All four nodes are verified.
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-1-planner"))?.status).toBe("verified");
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-1-task-1"))?.status).toBe("verified");
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-2-planner"))?.status).toBe("verified");
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-2-task-1"))?.status).toBe("verified");

    // Worktrees: 4 (one per node).
    expect(system.stubGit.worktreeCalls).toHaveLength(4);

    // Verifier: ran twice (once per Task; not for Planning Nodes).
    expect(system.stubProcessRunner.getRunCount()).toBe(2);

    // Approval driver fired 3 times: v1 (initial), v2 (Phase 1 emission),
    // v3 (Phase 2 emission).
    expect(approvedVersions.current).toEqual(new Set([1, 2, 3]));

    // Child threads: 4 (one per node).
    expect(projection?.childThreads.size).toBe(4);

    await system.dispose();
  }, 60_000);
});
