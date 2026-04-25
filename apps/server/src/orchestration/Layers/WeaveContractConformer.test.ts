/**
 * WeaveContractConformer tests.
 *
 * Uses the real OrchestrationEngine + WeaveEngine (matching WeaveScheduler.test.ts
 * pattern) with RuntimeReceiptBusLive (now broadcasting), and a stub ProcessRunner
 * that returns controlled exit codes without touching the filesystem.
 *
 * Coverage:
 *  1. Non-weave thread → conformer skips (no ProcessRunner.run call, no command).
 *  2. Weave child thread, stub exit 0 → weave.node.verified; status → "verified".
 *  3. Weave child thread, stub exit 1 → weave.node.failed (reason contains exit code);
 *     status → "failed".
 *  4. Stub reports timedOut: true → weave.node.failed with reason "timeout";
 *     status → "failed".
 */
import {
  Blueprint,
  BlueprintVersion,
  CommandId,
  ProjectId,
  ThreadId,
  TurnId,
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

function makeValidBlueprint(params: { nodeId: string; phaseId: string }): Blueprint {
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

describe("WeaveContractConformer", () => {
  it("skips receipt for a non-weave thread (no ProcessRunner call, no command dispatched)", async () => {
    const system = await createConformerSystem("t3-conformer-1-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const orphanThreadId = ThreadId.make(crypto.randomUUID());

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");

          // Publish a receipt for a thread that doesn't belong to any weave run
          yield* system.receiptBus.publish({
            type: "turn.processing.quiesced",
            threadId: orphanThreadId,
            turnId: TurnId.make(`turn-${crypto.randomUUID()}`),
            checkpointTurnCount: 0 as never,
            createdAt: now(),
          });

          yield* system.conformer.drain;
        }),
      ),
    );

    // ProcessRunner should not have been called
    expect(system.stubProcessRunner.getRunCount()).toBe(0);

    await system.dispose();
  });

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

          // Publish the quiesced receipt for the child thread
          yield* system.receiptBus.publish({
            type: "turn.processing.quiesced",
            threadId: childThreadId,
            turnId: TurnId.make(`turn-${crypto.randomUUID()}`),
            checkpointTurnCount: 1 as never,
            createdAt: now(),
          });

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

          yield* system.receiptBus.publish({
            type: "turn.processing.quiesced",
            threadId: childThreadId,
            turnId: `turn-${crypto.randomUUID()}` as never,
            checkpointTurnCount: 1 as never,
            createdAt: now(),
          });

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

          yield* system.receiptBus.publish({
            type: "turn.processing.quiesced",
            threadId: childThreadId,
            turnId: `turn-${crypto.randomUUID()}` as never,
            checkpointTurnCount: 1 as never,
            createdAt: now(),
          });

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
