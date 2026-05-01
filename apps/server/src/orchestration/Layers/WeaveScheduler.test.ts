/**
 * WeaveScheduler tests.
 *
 * Uses the real OrchestrationEngine + WeaveEngine (matching WeavePlanner.test.ts
 * pattern) and a stub GitCore that records createWorktree calls without touching
 * the filesystem. GitCore's stub returns a deterministic fake worktree path.
 *
 * Test coverage:
 *  1. blueprint-approved → 1 createWorktree, thread.create, weave.node.dispatch,
 *     thread.turn.start dispatched.
 *  2. node-verified for node-A when node-B depends on A → node-B dispatched.
 *  3. node-verified when all nodes verified → no new dispatch.
 *  4. Skips when run status is not "running".
 */
import {
  Blueprint,
  BlueprintVersion,
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { WeaveEngineLive } from "./WeaveEngine.ts";
import { WeaveSchedulerLive } from "./WeaveScheduler.ts";
import { WeaveScheduler } from "../Services/WeaveScheduler.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

const asProjectId = (value: string): ProjectId => ProjectId.make(value);

const FAKE_WORKSPACE_ROOT = "/tmp/fake-workspace";

function makeValidBlueprint(params: {
  nodeId: string;
  phaseId: string;
  dependsOn?: string[];
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
        kind: "raw",
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: (params.dependsOn ?? []).map((id) => WeaveNodeId.make(id)),
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

function makeTwoNodeBlueprint(): Blueprint {
  const phaseId = WeavePhaseId.make("phase-1");
  const nodeAId = WeaveNodeId.make("node-a");
  const nodeBId = WeaveNodeId.make("node-b");
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: nodeAId,
        title: "Node A",
        description: "First node",
        kind: "raw",
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "Node A done",
        dependsOn: [],
        status: "pending",
      },
      {
        id: nodeBId,
        title: "Node B",
        description: "Second node depends on A",
        kind: "raw",
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "Node B done",
        dependsOn: [nodeAId],
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

/**
 * Create a stub GitCore layer that records createWorktree calls and returns a
 * fake worktree path without touching the filesystem.
 */
function makeStubGitCore() {
  const worktreeCalls: { cwd: string; branch: string; newBranch: string | undefined }[] = [];
  let callCount = 0;

  const stubShape: GitCoreShape = {
    createWorktree: (input) => {
      const entry: { cwd: string; branch: string; newBranch: string | undefined } = {
        cwd: input.cwd,
        branch: input.branch,
        newBranch: input.newBranch,
      };
      worktreeCalls.push(entry);
      callCount++;
      const fakePath = `/tmp/fake-worktrees/${input.newBranch ?? input.branch}`;
      return Effect.succeed({
        worktree: { path: fakePath, branch: input.newBranch ?? input.branch },
      });
    },
    // All other methods are unused in these tests
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

  const layer = Layer.succeed(GitCore, GitCore.of(stubShape));

  return { layer, worktreeCalls, getCallCount: () => callCount };
}

// ── System factory ────────────────────────────────────────────────────────────

async function createSchedulerSystem(testPrefix: string) {
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
  const schedulerLayer = WeaveSchedulerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubGit.layer),
  );

  // Expose WeaveScheduler, WeaveEngineService, and OrchestrationEngineService
  const appLayer = schedulerLayer.pipe(
    Layer.provideMerge(weaveEngineLayer),
    Layer.provideMerge(orchestrationLayer),
  );

  const runtime = ManagedRuntime.make(appLayer);

  const { scheduler, weaveEngine, orchestrationEngine } = await runtime.runPromise(
    Effect.gen(function* () {
      return {
        scheduler: yield* WeaveScheduler,
        weaveEngine: yield* WeaveEngineService,
        orchestrationEngine: yield* OrchestrationEngineService,
      };
    }),
  );

  return {
    scheduler,
    weaveEngine,
    orchestrationEngine,
    stubGit,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

/**
 * Create a project (needed so thread.create can validate projectId).
 */
async function seedProject(
  orchestrationEngine: ReturnType<
    Awaited<ReturnType<typeof createSchedulerSystem>>["orchestrationEngine"]["getReadModel"]
  > extends infer _
    ? Awaited<ReturnType<typeof createSchedulerSystem>>["orchestrationEngine"]
    : never,
  projectId: string,
) {
  await Effect.runPromise(
    orchestrationEngine.dispatch({
      type: "project.create",
      commandId: CommandId.make(`cmd-project-${projectId}`),
      projectId: asProjectId(projectId),
      title: "Test Project",
      workspaceRoot: FAKE_WORKSPACE_ROOT,
      defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
      createdAt: now(),
    }),
  );
}

/**
 * Seed a weave run through its lifecycle up to "running" state with the given blueprint.
 */
async function seedRunningWeaveRun(
  weaveEngine: Awaited<ReturnType<typeof createSchedulerSystem>>["weaveEngine"],
  params: {
    runId: string;
    projectId: string;
    blueprint: Blueprint;
  },
) {
  const runId = WeaveRunId.make(params.runId);
  const projectId = asProjectId(params.projectId);

  // 1. Create the weave run
  await Effect.runPromise(
    weaveEngine.dispatchWeaveCommand({
      type: "weave.create",
      commandId: CommandId.make(`cmd-create-${params.runId}`),
      weaveRunId: runId,
      projectId,
      title: "Test Weave",
      vision: "Build something great",
      createdAt: now(),
    }),
  );

  // 2. Persist the planner event (transitions to "reviewing")
  await Effect.runPromise(
    weaveEngine.persistPlannerEvent({
      runId,
      blueprint: params.blueprint,
      compiledBy: "planner",
    }),
  );

  // 3. Approve the blueprint (transitions to "running", emits weave.blueprint-approved)
  await Effect.runPromise(
    weaveEngine.dispatchWeaveCommand({
      type: "weave.blueprint.approve",
      commandId: CommandId.make(`cmd-approve-${params.runId}`),
      weaveRunId: runId,
      blueprintVersion: params.blueprint.version,
      concurrencyCap: 1,
      createdAt: now(),
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WeaveScheduler", () => {
  it("on blueprint-approved with 1 node and no deps: allocates worktree, creates thread, dispatches node", async () => {
    const projectId = "project-sched-1";
    const runId = "run-sched-1";
    const system = await createSchedulerSystem("t3-weave-sched-1-");
    const { scheduler, weaveEngine, orchestrationEngine, stubGit } = system;

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* scheduler.start();
          yield* Effect.sleep("20 millis"); // allow subscriber to attach

          // Seed the project first (thread.create validates projectId)
          yield* orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });

          const blueprint = makeValidBlueprint({ nodeId: "node-1", phaseId: "phase-1" });

          // Seed the run (blueprint-approved event triggers the scheduler)
          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something great",
            createdAt: now(),
          });

          yield* weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });

          yield* scheduler.drain;
        }),
      ),
    );

    // GitCore should have been called once
    expect(stubGit.worktreeCalls).toHaveLength(1);
    expect(stubGit.worktreeCalls[0]?.cwd).toBe(FAKE_WORKSPACE_ROOT);
    expect(stubGit.worktreeCalls[0]?.branch).toBe("HEAD");
    expect(stubGit.worktreeCalls[0]?.newBranch).toMatch(/^weave-/);

    // The weave run should have the node in "running" state (dispatched)
    const projection = await system.run(weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection).not.toBeNull();
    expect(projection?.nodeMeta.get(WeaveNodeId.make("node-1"))?.status).toBe("running");
    expect(projection?.childThreads.size).toBe(1);
    expect(projection?.childThreads.get(WeaveNodeId.make("node-1"))).toBeDefined();

    // The read model should have 2 threads (no main thread in this test setup, just the child)
    const readModel = await system.run(orchestrationEngine.getReadModel());
    const weaveChildThread = readModel.threads.find(
      (t) =>
        t.worktreePath === projection?.childThreads.get(WeaveNodeId.make("node-1"))?.worktreePath,
    );
    expect(weaveChildThread).toBeDefined();
    expect(weaveChildThread?.interactionMode).toBe("default");

    // Verify that thread.turn.start was actually dispatched: replay all events
    // from the event store and assert a "thread.turn-start-requested" event
    // exists for the child thread. This would be absent if the scheduler's
    // final step (step 7) were silently removed.
    const allEvents = await system.run(Stream.runCollect(orchestrationEngine.readEvents(0)));
    const childThreadId = projection?.childThreads.get(WeaveNodeId.make("node-1"))?.threadId;
    const turnStartEvent = Array.from(allEvents).find(
      (e) => e.type === "thread.turn-start-requested" && e.payload.threadId === childThreadId,
    );
    expect(turnStartEvent).toBeDefined();

    await system.dispose();
  });

  it("on node-verified for node-A: dispatches node-B (which depends on A)", async () => {
    const projectId = "project-sched-2";
    const runId = "run-sched-2";
    const system = await createSchedulerSystem("t3-weave-sched-2-");
    const { scheduler, weaveEngine, orchestrationEngine, stubGit } = system;

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* scheduler.start();
          yield* Effect.sleep("20 millis");

          yield* orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });

          const blueprint = makeTwoNodeBlueprint();

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Two-node Weave",
            vision: "Build with dependency",
            createdAt: now(),
          });

          yield* weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });

          // Approve triggers scheduler for node-a (no deps)
          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });

          yield* scheduler.drain;

          // At this point node-a should be "running"; node-b still "pending"
          const p1 = yield* weaveEngine.getWeaveRun(WeaveRunId.make(runId));
          expect(p1?.nodeMeta.get(WeaveNodeId.make("node-a"))?.status).toBe("running");
          expect(p1?.nodeMeta.get(WeaveNodeId.make("node-b"))?.status).toBe("pending");

          // Simulate node-a being verified (triggers scheduler for node-b)
          const nodeAChildThread = p1?.childThreads.get(WeaveNodeId.make("node-a"));
          expect(nodeAChildThread).toBeDefined();

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.node.verified",
            commandId: CommandId.make(`cmd-verify-node-a-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            nodeId: WeaveNodeId.make("node-a"),
            verifierOutcome: "All node-a tests pass.",
            createdAt: now(),
          });

          yield* scheduler.drain;
        }),
      ),
    );

    // GitCore should have been called twice: once for node-a, once for node-b
    expect(stubGit.worktreeCalls).toHaveLength(2);

    const projection = await system.run(weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    // node-a is "verified" now
    expect(projection?.nodeMeta.get(WeaveNodeId.make("node-a"))?.status).toBe("verified");
    // node-b was picked up and is now "running"
    expect(projection?.nodeMeta.get(WeaveNodeId.make("node-b"))?.status).toBe("running");
    expect(projection?.childThreads.get(WeaveNodeId.make("node-b"))).toBeDefined();

    await system.dispose();
  });

  it("on node-verified when all nodes are verified: no new dispatch", async () => {
    const projectId = "project-sched-3";
    const runId = "run-sched-3";
    const system = await createSchedulerSystem("t3-weave-sched-3-");
    const { scheduler, weaveEngine, orchestrationEngine, stubGit } = system;

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* scheduler.start();
          yield* Effect.sleep("20 millis");

          yield* orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });

          const blueprint = makeValidBlueprint({ nodeId: "node-only", phaseId: "phase-1" });

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Single-node Weave",
            vision: "Single node",
            createdAt: now(),
          });

          yield* weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });

          yield* scheduler.drain;

          // Verify the only node — should trigger scheduler but find nothing ready
          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.node.verified",
            commandId: CommandId.make(`cmd-verify-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            nodeId: WeaveNodeId.make("node-only"),
            verifierOutcome: "All tests pass.",
            createdAt: now(),
          });

          yield* scheduler.drain;
        }),
      ),
    );

    // Only 1 createWorktree call (initial dispatch); no second call on verify
    expect(stubGit.worktreeCalls).toHaveLength(1);

    await system.dispose();
  });

  it("skips when run status is not running (e.g. after weave.exited)", async () => {
    /**
     * Properly exercises the `run.run.status !== "running"` guard in
     * processSchedulerDecision.
     *
     * Sequence:
     *  1. Single-node blueprint. Approve → scheduler dispatches node-only (1 worktree call).
     *  2. Exit the run (status → "aborted").
     *  3. Inject a fake `weave.node-verified` event via appendSystemEvent — bypassing
     *     the decider's status check so the scheduler actually receives the trigger.
     *  4. Drain. Assert no second worktree call — the running-guard fires and skips.
     *
     * We use appendSystemEvent because `weave.node.verified` (via dispatchWeaveCommand)
     * requires the run to be in "running" status and would be rejected after exit.
     */
    const projectId = "project-sched-4";
    const runId = "run-sched-4";
    const system = await createSchedulerSystem("t3-weave-sched-4-");
    const { scheduler, weaveEngine, orchestrationEngine, stubGit } = system;

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* scheduler.start();
          yield* Effect.sleep("20 millis");

          yield* orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });

          const blueprint = makeValidBlueprint({ nodeId: "node-only", phaseId: "phase-1" });

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Exit Weave",
            vision: "This weave will be aborted",
            createdAt: now(),
          });

          yield* weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });

          // Step 1: approve → scheduler dispatches node-only (worktreeCalls = 1)
          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });

          yield* scheduler.drain;
          expect(stubGit.worktreeCalls).toHaveLength(1);

          // Step 2: exit the run → status becomes "aborted"
          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.exit",
            commandId: CommandId.make(`cmd-exit-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            reason: "aborted",
            createdAt: now(),
          });

          // Step 3: inject a fake weave.node-verified event directly, bypassing
          // the decider which would reject the command on an aborted run.
          // This simulates a late verifier outcome landing after the run ended.
          const weaveRunId = WeaveRunId.make(runId);
          const occurredAt = now();
          yield* orchestrationEngine.appendSystemEvent({
            eventId: EventId.make(crypto.randomUUID()),
            aggregateKind: "weave" as const,
            aggregateId: weaveRunId,
            occurredAt,
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            type: "weave.node-verified",
            payload: {
              weaveRunId,
              nodeId: WeaveNodeId.make("node-only"),
              verifierOutcome: "late outcome",
              occurredAt,
            },
          });

          // Step 4: drain — scheduler picks up the trigger but the running-guard
          // fires because run.status is "aborted"; no new worktree call.
          yield* scheduler.drain;
        }),
      ),
    );

    // Still only 1 worktree call (from the initial approve), not 2.
    expect(stubGit.worktreeCalls).toHaveLength(1);

    const projection = await system.run(weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection?.run.status).toBe("aborted");

    await system.dispose();
  });
});

describe("WeaveScheduler — kind-stratified ready check", () => {
  /**
   * Build a 2-Phase meta-blueprint: Phase 1 has one Planning Node, Phase 2
   * has one Planning Node. Both Planning Nodes have empty dependsOn (the
   * meta-planner doesn't set cross-Phase dependencies — Phase ordering
   * is enforced by the scheduler's kind-stratified check).
   */
  function makeTwoPhaseMetaBlueprint(): Blueprint {
    const phase1Id = WeavePhaseId.make("phase-1");
    const phase2Id = WeavePhaseId.make("phase-2");
    return Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: WeaveNodeId.make("phase-1-planner"),
          title: "Phase 1 Planner",
          description: "",
          kind: "planning",
          phaseId: phase1Id,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
        {
          id: WeaveNodeId.make("phase-2-planner"),
          title: "Phase 2 Planner",
          description: "",
          kind: "planning",
          phaseId: phase2Id,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        { id: phase1Id, ordinal: 0, title: "Phase 1", description: "", approval: "pending" },
        { id: phase2Id, ordinal: 1, title: "Phase 2", description: "", approval: "pending" },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now(),
      compiledBy: "planner",
    });
  }

  it("dispatches Phase 1's Planning Node first when run starts", async () => {
    const projectId = "project-kind-1";
    const runId = "run-kind-1";
    const system = await createSchedulerSystem("t3-scheduler-kind-1-");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis"); // allow subscriber to attach

          yield* Effect.promise(() => seedProject(system.orchestrationEngine, projectId));
          yield* Effect.promise(() =>
            seedRunningWeaveRun(system.weaveEngine, {
              runId,
              projectId,
              blueprint: makeTwoPhaseMetaBlueprint(),
            }),
          );

          yield* system.scheduler.drain;
        }),
      ),
    );

    expect(system.stubGit.getCallCount()).toBe(1);
    expect(system.stubGit.worktreeCalls[0]?.newBranch).toMatch(/phase-1-planner/);

    await system.dispose();
  });

  it("does NOT dispatch Phase 2's Planning Node while Phase 1's Planning Node is still pending", async () => {
    const projectId = "project-kind-2";
    const runId = "run-kind-2";
    const system = await createSchedulerSystem("t3-scheduler-kind-2-");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis"); // allow subscriber to attach

          yield* Effect.promise(() => seedProject(system.orchestrationEngine, projectId));
          yield* Effect.promise(() =>
            seedRunningWeaveRun(system.weaveEngine, {
              runId,
              projectId,
              blueprint: makeTwoPhaseMetaBlueprint(),
            }),
          );

          yield* system.scheduler.drain;
        }),
      ),
    );

    // Only Phase 1's Planning Node dispatched; Phase 2's Planning Node is
    // gated by the kind-stratified check.
    expect(system.stubGit.getCallCount()).toBe(1);
    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-2-planner"))?.status).toBe("pending");

    await system.dispose();
  });

  it("dispatches Phase 2's Planning Node once every Phase 1 node is verified", async () => {
    const projectId = "project-kind-3";
    const runId = "run-kind-3";
    const system = await createSchedulerSystem("t3-scheduler-kind-3-");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis"); // allow subscriber to attach

          yield* Effect.promise(() => seedProject(system.orchestrationEngine, projectId));
          yield* Effect.promise(() =>
            seedRunningWeaveRun(system.weaveEngine, {
              runId,
              projectId,
              blueprint: makeTwoPhaseMetaBlueprint(),
            }),
          );

          yield* system.scheduler.drain;

          // Manually mark phase-1-planner verified via a system event so the
          // kind-stratified check unblocks Phase 2.
          yield* system.orchestrationEngine.appendSystemEvent({
            eventId: EventId.make(crypto.randomUUID()),
            aggregateKind: "weave",
            aggregateId: WeaveRunId.make(runId),
            type: "weave.node-verified",
            occurredAt: now(),
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            payload: {
              weaveRunId: WeaveRunId.make(runId),
              nodeId: WeaveNodeId.make("phase-1-planner"),
              verifierOutcome: "ok",
              occurredAt: now(),
            },
          });

          yield* system.scheduler.drain;
        }),
      ),
    );

    // Both planning nodes have been dispatched (Phase 1 at run start, Phase
    // 2 after Phase 1's planner verified).
    expect(system.stubGit.getCallCount()).toBe(2);
    const branches = system.stubGit.worktreeCalls.map((c) => c.newBranch ?? "");
    expect(branches.some((b) => b.includes("phase-1-planner"))).toBe(true);
    expect(branches.some((b) => b.includes("phase-2-planner"))).toBe(true);

    await system.dispose();
  });

  it("Tasks (kind != 'planning') still use dependsOn-based ready check", async () => {
    // This is a regression check. Reuse the existing 2-node blueprint helper
    // (makeTwoNodeBlueprint, which has node-a + node-b where b depends on a,
    // both kind 'raw'). Ensure node-a dispatches first; node-b only after a
    // is verified.
    const projectId = "project-kind-4";
    const runId = "run-kind-4";
    const system = await createSchedulerSystem("t3-scheduler-kind-4-");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis"); // allow subscriber to attach

          yield* Effect.promise(() => seedProject(system.orchestrationEngine, projectId));
          yield* Effect.promise(() =>
            seedRunningWeaveRun(system.weaveEngine, {
              runId,
              projectId,
              blueprint: makeTwoNodeBlueprint(),
            }),
          );

          yield* system.scheduler.drain;
        }),
      ),
    );

    // Only node-a dispatched (node-b waits on node-a verifying).
    expect(system.stubGit.getCallCount()).toBe(1);
    expect(system.stubGit.worktreeCalls[0]?.newBranch).toMatch(/node-a/);

    await system.dispose();
  });
});

import { formatPlanningNodeSpec } from "./WeaveScheduler.ts";

describe("formatPlanningNodeSpec", () => {
  function makePlanningNode(params: { id?: string; phaseId?: string; description?: string } = {}) {
    const phaseId = WeavePhaseId.make(params.phaseId ?? "phase-1");
    const nodeId = WeaveNodeId.make(params.id ?? "plan-phase-1");
    return Schema.decodeSync(
      Schema.Struct({
        id: WeaveNodeId,
        title: Schema.String,
        description: Schema.String,
        kind: Schema.Literal("planning"),
        phaseId: WeavePhaseId,
        scope: Schema.Struct({
          readSet: Schema.Array(Schema.String),
          writeSet: Schema.Array(Schema.String),
        }),
        inputContractIds: Schema.Array(Schema.String),
        outputContractIds: Schema.Array(Schema.String),
        verifierDescription: Schema.String,
        dependsOn: Schema.Array(WeaveNodeId),
        status: Schema.Literal("pending"),
      }),
    )({
      id: nodeId,
      title: "Plan Phase 1",
      description: params.description ?? "Plan the scaffolding sub-tasks for Phase 1",
      kind: "planning",
      phaseId,
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "PhasePlannerOutput JSON",
      dependsOn: [],
      status: "pending",
    });
  }

  function makePlanningBlueprint(params: { phaseId?: string; phaseTitle?: string; phaseDescription?: string } = {}): Blueprint {
    const phaseId = WeavePhaseId.make(params.phaseId ?? "phase-1");
    return Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: WeaveNodeId.make("plan-phase-1"),
          title: "Plan Phase 1",
          description: "Plan the scaffolding sub-tasks for Phase 1",
          kind: "planning",
          phaseId,
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
          id: phaseId,
          ordinal: 0,
          title: params.phaseTitle ?? "Phase 1: Scaffolding",
          description: params.phaseDescription ?? "Stand up the project skeleton",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now(),
      compiledBy: "planner",
    });
  }

  it("passes vision through to the prompt", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint();
    const text = formatPlanningNodeSpec(node, blueprint, {
      vision: "Build a minimal todo app",
    });
    expect(text).toContain("Build a minimal todo app");
  });

  it("passes snapshotContent through to the prompt", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint();
    const text = formatPlanningNodeSpec(node, blueprint, {
      vision: "ignored here",
      snapshotContent: "FILE_TREE_HERE",
    });
    expect(text).toContain("FILE_TREE_HERE");
  });

  it("falls back to '(empty)' when snapshotContent is undefined", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint();
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("(empty)");
  });

  it("includes the planner node's description", () => {
    const node = makePlanningNode({
      description: "Plan the database migration tasks for this phase.",
    });
    const blueprint = Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: node.id,
          title: node.title,
          description: node.description,
          kind: "planning",
          phaseId: node.phaseId,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: node.verifierDescription,
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        {
          id: node.phaseId,
          ordinal: 0,
          title: "Phase 1",
          description: "x",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now(),
      compiledBy: "planner",
    });
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("Plan the database migration tasks for this phase.");
  });

  it("includes the planner's phaseId in the prompt template", () => {
    const node = makePlanningNode({ phaseId: "phase-42" });
    const blueprint = makePlanningBlueprint({ phaseId: "phase-42" });
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("phase-42");
  });

  it("includes the looked-up phase title and description", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint({
      phaseTitle: "PHASE_TITLE_MARKER",
      phaseDescription: "PHASE_DESCRIPTION_MARKER",
    });
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("PHASE_TITLE_MARKER");
    expect(text).toContain("PHASE_DESCRIPTION_MARKER");
  });

  it("throws when the phase is missing from the blueprint", () => {
    const node = makePlanningNode({ phaseId: "phase-orphan" });
    // Build a blueprint whose phase id doesn't match the node's phaseId.
    // If the Blueprint schema enforces phase/node consistency at decode time
    // and rejects this construction, build a mismatched node directly without
    // round-tripping the orphan node through Schema.decodeSync — what we are
    // testing is formatPlanningNodeSpec's behavior when blueprint.phases does
    // not contain a phase with id === node.phaseId.
    const orphanNode = { ...node, phaseId: WeavePhaseId.make("does-not-exist") };
    const blueprint = makePlanningBlueprint({ phaseId: "phase-1" });
    expect(() =>
      formatPlanningNodeSpec(orphanNode as typeof node, blueprint, { vision: "v" }),
    ).toThrow(/unknown phase|does-not-exist/);
  });
});
