/**
 * WeaveContractConformer tests.
 *
 * Uses the real OrchestrationEngine + WeaveEngine (matching WeaveScheduler.test.ts
 * pattern) and a stub ProcessRunner that returns controlled exit codes without
 * touching the filesystem. Triggers the conformer by dispatching
 * `thread.session.set` with the child thread reaching status="ready" /
 * activeTurnId=null — that's the same domain event ProviderRuntimeIngestion
 * emits when the harness ends its turn.
 *
 * Coverage:
 *  1. Weave child thread, stub exit 0 → weave.node.verified; status → "verified".
 *  2. Weave child thread, stub exit 1 → weave.node.failed (reason contains exit code);
 *     status → "failed".
 *  3. Stub reports timedOut: true → weave.node.failed with reason "timeout";
 *     status → "failed".
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
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusLive } from "./RuntimeReceiptBus.ts";
import { WeaveEngineLive } from "./WeaveEngine.ts";
import { WeaveSchedulerLive } from "./WeaveScheduler.ts";
import { WeaveContractConformerLive } from "./WeaveContractConformer.ts";
import { WeaveContractConformer } from "../Services/WeaveContractConformer.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { WeaveScheduler } from "../Services/WeaveScheduler.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import {
  ProcessRunner,
  type ProcessRunnerShape,
  type ProcessRunnerResult,
} from "../Services/ProcessRunner.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

const asProjectId = (value: string): ProjectId => ProjectId.make(value);

const FAKE_WORKSPACE_ROOT = "/tmp/fake-workspace-conformer";

function makeValidBlueprint(params: {
  nodeId: string;
  phaseId: string;
  kind?: "raw" | "scaffold" | "contract" | "utility" | "planning";
}): Blueprint {
  const phaseId = WeavePhaseId.make(params.phaseId);
  const nodeId = WeaveNodeId.make(params.nodeId);
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: nodeId,
        title: "Test Node",
        description: "A test implementation node",
        kind: params.kind ?? "raw",
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: [],
        status: "pending",
      },
    ],
    phases: [
      {
        id: phaseId,
        ordinal: 0,
        title: "Phase 1",
        description: "First phase",
        approval: "pending",
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: now(),
    compiledBy: "planner",
  });
}

// ── Stub GitCore ──────────────────────────────────────────────────────────────

function makeStubGitCore() {
  const stubShape: GitCoreShape = {
    createWorktree: (input) => {
      const fakePath = `/tmp/fake-worktrees-conformer/${input.newBranch ?? input.branch}`;
      return Effect.succeed({
        worktree: { path: fakePath, branch: input.newBranch ?? input.branch },
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
  return Layer.succeed(GitCore, GitCore.of(stubShape));
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

// ── System factory ────────────────────────────────────────────────────────────

async function createConformerSystem(testPrefix: string, processRunnerResult: ProcessRunnerResult) {
  const stubGitLayer = makeStubGitCore();
  const stubProcessRunner = makeStubProcessRunner(processRunnerResult);

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

  const schedulerLayer = WeaveSchedulerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubGitLayer),
  );

  const conformerLayer = WeaveContractConformerLive.pipe(
    Layer.provide(receiptBusLayer),
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubProcessRunner.layer),
  );

  const appLayer = conformerLayer.pipe(
    Layer.provideMerge(schedulerLayer),
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
        weaveEngine: yield* WeaveEngineService,
        orchestrationEngine: yield* OrchestrationEngineService,
        receiptBus: yield* RuntimeReceiptBus,
      };
    }),
  );

  return {
    ...services,
    stubProcessRunner,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedProjectAndRunningWeave(
  system: Awaited<ReturnType<typeof createConformerSystem>>,
  params: {
    projectId: string;
    runId: string;
    nodeId: string;
  },
) {
  const { orchestrationEngine, weaveEngine, scheduler } = system;
  const blueprint = makeValidBlueprint({ nodeId: params.nodeId, phaseId: "phase-1" });

  await system.run(
    Effect.scoped(
      Effect.gen(function* () {
        // Start the scheduler so it receives the blueprint-approved event.
        yield* scheduler.start();
        yield* Effect.sleep("20 millis");

        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`cmd-project-${params.projectId}`),
          projectId: asProjectId(params.projectId),
          title: "Test Project",
          workspaceRoot: FAKE_WORKSPACE_ROOT,
          defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
          createdAt: now(),
        });

        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.create",
          commandId: CommandId.make(`cmd-create-${params.runId}`),
          weaveRunId: WeaveRunId.make(params.runId),
          projectId: asProjectId(params.projectId),
          title: "Test Weave",
          vision: "Build something",
          createdAt: now(),
        });

        yield* weaveEngine.persistPlannerEvent({
          runId: WeaveRunId.make(params.runId),
          blueprint,
          compiledBy: "planner",
        });

        // Approve triggers the scheduler; drain so the node gets dispatched
        // (worktree created, child thread created).
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.blueprint.approve",
          commandId: CommandId.make(`cmd-approve-${params.runId}`),
          weaveRunId: WeaveRunId.make(params.runId),
          blueprintVersion: blueprint.version,
          concurrencyCap: 1,
          createdAt: now(),
        });

        yield* scheduler.drain;
      }),
    ),
  );

  // Return the child thread that was allocated by the scheduler
  const projection = await system.run(weaveEngine.getWeaveRun(WeaveRunId.make(params.runId)));
  const childEntry = projection?.childThreads.get(WeaveNodeId.make(params.nodeId));
  if (!childEntry) throw new Error("Expected child thread to be allocated by scheduler");

  return { blueprint, projection, childThreadId: childEntry.threadId };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Drives the conformer by dispatching `thread.session.set` for the child
 * thread, mirroring what ProviderRuntimeIngestion does on `turn.completed`.
 */
function* dispatchSessionReady(
  orchestrationEngine: ReturnType<typeof OrchestrationEngineService.of>,
  threadId: ThreadId,
) {
  const updatedAt = now();
  yield* orchestrationEngine.dispatch({
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
      updatedAt,
    },
    createdAt: updatedAt,
  });
}

async function injectAssistantMessage(
  system: Awaited<ReturnType<typeof createConformerSystem>>,
  threadId: ThreadId,
  text: string,
): Promise<void> {
  const occurredAt = now();
  await system.run(
    system.orchestrationEngine.appendSystemEvent({
      eventId: EventId.make(crypto.randomUUID()),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.message-sent",
      occurredAt,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        messageId: MessageId.make(`msg-${crypto.randomUUID()}`),
        role: "assistant",
        text,
        turnId: null,
        streaming: false,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    }),
  );
}

describe("WeaveContractConformer", () => {
  it("exit 0 → dispatches weave.node.verified; projection status becomes 'verified'", async () => {
    const projectId = "project-conformer-2";
    const runId = "run-conformer-2";
    const nodeId = "node-conformer-2";

    const system = await createConformerSystem("t3-conformer-2-", {
      exitCode: 0,
      stdout: "All tests passed\n",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const { childThreadId } = await seedProjectAndRunningWeave(system, {
      projectId,
      runId,
      nodeId,
    });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");

          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);

          yield* system.conformer.drain;
        }),
      ),
    );

    expect(system.stubProcessRunner.getRunCount()).toBe(1);

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("verified");

    await system.dispose();
  });

  it("exit 1 → dispatches weave.node.failed with exit code in reason; status becomes 'failed'", async () => {
    const projectId = "project-conformer-3";
    const runId = "run-conformer-3";
    const nodeId = "node-conformer-3";

    const system = await createConformerSystem("t3-conformer-3-", {
      exitCode: 1,
      stdout: "",
      stderr: "1 test failed\n",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const { childThreadId } = await seedProjectAndRunningWeave(system, {
      projectId,
      runId,
      nodeId,
    });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");

          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);

          yield* system.conformer.drain;
        }),
      ),
    );

    expect(system.stubProcessRunner.getRunCount()).toBe(1);

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("failed");

    // Assert failure reason contains the exit code (not a timeout reason).
    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const failedEvent = allEvents.find(
      (e) =>
        e.type === "weave.node-failed" &&
        "payload" in e &&
        (e.payload as { nodeId: string }).nodeId === nodeId,
    );
    expect(failedEvent).toBeDefined();
    const reason = (failedEvent as { payload: { reason: string } }).payload.reason;
    expect(reason).toContain("exit 1");
    expect(reason).not.toBe("timeout");

    await system.dispose();
  });

  it("timedOut: true → dispatches weave.node.failed with reason 'timeout'; status becomes 'failed'", async () => {
    const projectId = "project-conformer-4";
    const runId = "run-conformer-4";
    const nodeId = "node-conformer-4";

    const system = await createConformerSystem("t3-conformer-4-", {
      exitCode: -1,
      stdout: "",
      stderr: "",
      timedOut: true,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const { childThreadId } = await seedProjectAndRunningWeave(system, {
      projectId,
      runId,
      nodeId,
    });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");

          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);

          yield* system.conformer.drain;
        }),
      ),
    );

    expect(system.stubProcessRunner.getRunCount()).toBe(1);

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("failed");

    // Assert failure reason is exactly "timeout" (not an exit-code reason).
    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const failedEvent = allEvents.find(
      (e) =>
        e.type === "weave.node-failed" &&
        "payload" in e &&
        (e.payload as { nodeId: string }).nodeId === nodeId,
    );
    expect(failedEvent).toBeDefined();
    const reason = (failedEvent as { payload: { reason: string } }).payload.reason;
    expect(reason).toBe("timeout");

    await system.dispose();
  });
});

describe("WeaveContractConformer — planning kind", () => {
  it("happy path: valid PhasePlannerOutput → dispatches weave.blueprint.extend", async () => {
    const projectId = "project-conformer-planning-1";
    const runId = "run-conformer-planning-1";
    const nodeId = "node-conformer-planning-1";

    const system = await createConformerSystem("t3-conformer-planning-1-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const blueprint = makeValidBlueprint({ nodeId, phaseId: "phase-1", kind: "planning" });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something",
            createdAt: now(),
          });
          yield* system.weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });
          yield* system.scheduler.drain;
        }),
      ),
    );

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    const childEntry = projection?.childThreads.get(WeaveNodeId.make(nodeId));
    if (!childEntry) throw new Error("Expected child thread to be allocated by scheduler");
    const childThreadId = childEntry.threadId;

    const validOutput = {
      addedNodes: [
        {
          id: "task-1",
          title: "Task 1",
          description: "First task in phase 1",
          kind: "raw",
          phaseId: "phase-1",
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "bun run test",
          dependsOn: [],
          status: "pending",
        },
      ],
    };
    await injectAssistantMessage(system, childThreadId, JSON.stringify(validOutput));

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");
          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);
          yield* system.conformer.drain;
        }),
      ),
    );

    expect(system.stubProcessRunner.getRunCount()).toBe(0);

    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const extendedEvent = allEvents.find((e) => e.type === "weave.blueprint-extended");
    expect(extendedEvent).toBeDefined();
    const extendedPayload = (
      extendedEvent as {
        payload: { plannerNodeId: string; addedNodeIds: ReadonlyArray<string> };
      }
    ).payload;
    expect(extendedPayload.plannerNodeId).toBe(nodeId);
    expect(extendedPayload.addedNodeIds).toEqual(["task-1"]);

    // Slice 4 fix: the `weave.blueprint-compiled` projector arm now preserves
    // prior `nodeMeta` entries, so the planner node keeps its `verified`
    // status set by the preceding `weave.node-verified` event in the same
    // dispatch batch.
    const finalProjection = await system.run(
      system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)),
    );
    expect(finalProjection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("verified");

    await system.dispose();
  });

  it("parse failure: malformed JSON → dispatches weave.node.failed (reason mentions JSON parse)", async () => {
    const projectId = "project-conformer-planning-2";
    const runId = "run-conformer-planning-2";
    const nodeId = "node-conformer-planning-2";

    const system = await createConformerSystem("t3-conformer-planning-2-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const blueprint = makeValidBlueprint({ nodeId, phaseId: "phase-1", kind: "planning" });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something",
            createdAt: now(),
          });
          yield* system.weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });
          yield* system.scheduler.drain;
        }),
      ),
    );

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    const childEntry = projection?.childThreads.get(WeaveNodeId.make(nodeId));
    if (!childEntry) throw new Error("Expected child thread");
    const childThreadId = childEntry.threadId;

    await injectAssistantMessage(system, childThreadId, "{not json");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");
          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);
          yield* system.conformer.drain;
        }),
      ),
    );

    expect(system.stubProcessRunner.getRunCount()).toBe(0);

    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const failedEvent = allEvents.find(
      (e) =>
        e.type === "weave.node-failed" &&
        "payload" in e &&
        (e.payload as { nodeId: string }).nodeId === nodeId,
    );
    expect(failedEvent).toBeDefined();
    const reason = (failedEvent as { payload: { reason: string } }).payload.reason;
    expect(reason.toLowerCase()).toContain("parse");

    const finalProjection = await system.run(
      system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)),
    );
    expect(finalProjection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("failed");

    await system.dispose();
  });

  it("schema failure: valid JSON, wrong shape → dispatches weave.node.failed (reason mentions decode)", async () => {
    const projectId = "project-conformer-planning-3";
    const runId = "run-conformer-planning-3";
    const nodeId = "node-conformer-planning-3";

    const system = await createConformerSystem("t3-conformer-planning-3-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const blueprint = makeValidBlueprint({ nodeId, phaseId: "phase-1", kind: "planning" });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something",
            createdAt: now(),
          });
          yield* system.weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });
          yield* system.scheduler.drain;
        }),
      ),
    );

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    const childEntry = projection?.childThreads.get(WeaveNodeId.make(nodeId));
    if (!childEntry) throw new Error("Expected child thread");
    const childThreadId = childEntry.threadId;

    // Valid JSON, but no `addedNodes` field.
    await injectAssistantMessage(system, childThreadId, JSON.stringify({ foo: 1 }));

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");
          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);
          yield* system.conformer.drain;
        }),
      ),
    );

    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const failedEvent = allEvents.find(
      (e) =>
        e.type === "weave.node-failed" &&
        "payload" in e &&
        (e.payload as { nodeId: string }).nodeId === nodeId,
    );
    expect(failedEvent).toBeDefined();
    const reason = (failedEvent as { payload: { reason: string } }).payload.reason;
    expect(reason.toLowerCase()).toContain("decode");

    await system.dispose();
  });
});
