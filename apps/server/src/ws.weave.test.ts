import {
  CommandId,
  WeaveRunId,
  WeaveNodeId,
  ProjectId,
  WeavePhaseId,
  WeaveDecisionId,
  type WeaveDispatchableCommand,
  type WeaveRunProjection,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { buildWeaveRunShell } from "./ws.ts";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts.ts";
import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { WeaveEngineLive } from "./orchestration/Layers/WeaveEngine.ts";
import { WeaveEngineService } from "./orchestration/Services/WeaveEngine.ts";
import { ServerConfig } from "./config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

function now() {
  return new Date().toISOString();
}

async function createOrchestrationSystem() {
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-ws-weave-test-",
  });
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
  const combinedLayer = Layer.provideMerge(weaveEngineLayer, orchestrationLayer);
  const runtime = ManagedRuntime.make(combinedLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const weaveEngine = await runtime.runPromise(Effect.service(WeaveEngineService));
  return {
    engine,
    weaveEngine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

describe("ws.weave RPC integration", () => {
  describe("orchestration engine accepts weave dispatchable commands", () => {
    it("engine.dispatch accepts weave.create and returns a result with sequence", async () => {
      const system = await createOrchestrationSystem();
      try {
        const weaveRunId = WeaveRunId.make("test-run");
        const projectId = ProjectId.make("test-project");
        const commandId = CommandId.make("test-cmd");
        const createdAt = now();

        const command: WeaveDispatchableCommand = {
          type: "weave.create",
          commandId,
          weaveRunId,
          projectId,
          title: "Test Weave",
          vision: "test vision",
          createdAt,
        };

        const result = await system.run(system.engine.dispatch(command));
        expect(result).toBeDefined();
        expect(result.sequence).toBeDefined();
        expect(typeof result.sequence).toBe("number");
        expect(result.sequence).toBeGreaterThan(0);
      } finally {
        await system.dispose();
      }
    });
  });

  describe("weave.create dispatch via normalized command", () => {
    it("dispatches weave.create through orchestration pipeline", async () => {
      const system = await createOrchestrationSystem();
      try {
        const weaveRunId = WeaveRunId.make("integration-test-run");
        const projectId = ProjectId.make("integration-test-project");
        const commandId = CommandId.make("integration-test-cmd");
        const createdAt = now();

        const command: WeaveDispatchableCommand = {
          type: "weave.create",
          commandId,
          weaveRunId,
          projectId,
          title: "Integration Test Weave",
          vision: "test vision for integration",
          createdAt,
        };

        const result = await system.run(system.engine.dispatch(command));

        expect(result).toBeDefined();
        expect(result.sequence).toBeDefined();
        expect(typeof result.sequence).toBe("number");
        expect(result.sequence).toBeGreaterThan(0);

        // Verify that the weave projection is created with status = "draft"
        const projection = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
        expect(projection).not.toBeNull();
        expect(projection?.run.status).toBe("draft");
      } finally {
        await system.dispose();
      }
    });
  });

  describe("subscribeWeaveRun snapshot + stream", () => {
    it("getWeaveRun returns null before create and snapshot after", async () => {
      const system = await createOrchestrationSystem();
      try {
        const weaveRunId = WeaveRunId.make("subscribe-test-run");
        const projectId = ProjectId.make("subscribe-test-project");

        // Before create: getWeaveRun returns null (snapshot would not be emitted).
        const before = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
        expect(before).toBeNull();

        // Dispatch weave.create to set up the run.
        const command: WeaveDispatchableCommand = {
          type: "weave.create",
          commandId: CommandId.make("subscribe-cmd"),
          weaveRunId,
          projectId,
          title: "Subscribe Test Weave",
          vision: "subscribe test vision",
          createdAt: now(),
        };
        await system.run(system.engine.dispatch(command));

        // After create: getWeaveRun returns the projection (snapshot kind would be emitted).
        const snapshot = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
        expect(snapshot).not.toBeNull();
        expect(snapshot?.run.status).toBe("draft");
        expect(snapshot?.run.id).toBe(weaveRunId);

        // Verify snapshotSequence is available from the read model.
        const readModel = await system.run(system.engine.getReadModel());
        expect(readModel.snapshotSequence).toBeGreaterThan(0);
      } finally {
        await system.dispose();
      }
    });

    it("streamWeaveEvents emits a weave.created event after dispatch", async () => {
      const system = await createOrchestrationSystem();
      try {
        const weaveRunId = WeaveRunId.make("stream-events-test-run");
        const projectId = ProjectId.make("stream-events-test-project");

        const collectedTypes: string[] = [];

        await system.run(
          Effect.gen(function* () {
            const weaveQueue = yield* Queue.unbounded<string>();

            // Subscribe to the stream via forkScoped + sleep to ensure attachment.
            yield* Effect.forkScoped(
              Stream.take(system.weaveEngine.streamWeaveEvents, 1).pipe(
                Stream.runForEach((event) => Queue.offer(weaveQueue, event.type)),
              ),
            );

            // Give the subscriber time to attach.
            yield* Effect.sleep("10 millis");

            // Dispatch weave.create — emits weave.created on the stream.
            yield* system.engine.dispatch({
              type: "weave.create",
              commandId: CommandId.make("stream-events-cmd"),
              weaveRunId,
              projectId,
              title: "Stream Events Test Weave",
              vision: "stream events test vision",
              createdAt: now(),
            });

            // Collect the one weave event.
            const eventType = yield* Queue.take(weaveQueue);
            collectedTypes.push(eventType);
          }).pipe(Effect.scoped),
        );

        expect(collectedTypes).toEqual(["weave.created"]);
      } finally {
        await system.dispose();
      }
    });
  });

  describe("buildWeaveRunShell unit", () => {
    it("maps a WeaveRunProjection with mixed node statuses to correct shell counts", () => {
      const runId = WeaveRunId.make("unit-test-run");
      const projectId = ProjectId.make("unit-test-project");
      const createdAt = "2026-04-24T00:00:00.000Z" as const;

      const nodeMeta = new Map([
        [WeaveNodeId.make("n1"), { status: "pending" as const }],
        [WeaveNodeId.make("n2"), { status: "pending" as const }],
        [WeaveNodeId.make("n3"), { status: "ready" as const }],
        [WeaveNodeId.make("n4"), { status: "running" as const }],
        [WeaveNodeId.make("n5"), { status: "verified" as const }],
        [WeaveNodeId.make("n6"), { status: "failed" as const }],
        [WeaveNodeId.make("n7"), { status: "paused" as const }],
      ]);

      const projection: WeaveRunProjection = {
        run: {
          id: runId,
          projectId,
          title: "Unit Test Weave",
          vision: "unit test vision",
          status: "running",
          concurrencyCap: 4,
          createdAt,
        },
        currentBlueprint: null,
        nodeMeta,
        openDecisions: new Set(),
        autoDecisionLog: [],
        phaseApprovals: new Map(),
        childThreads: new Map(),
      };

      const shell = buildWeaveRunShell(projection);

      expect(shell.id).toBe(runId);
      expect(shell.projectId).toBe(projectId);
      expect(shell.title).toBe("Unit Test Weave");
      expect(shell.status).toBe("running");
      expect(shell.createdAt).toBe(createdAt);
      expect(shell.updatedAt).toBe(createdAt);
      expect(shell.pendingCount).toBe(2);
      expect(shell.readyCount).toBe(1);
      expect(shell.runningCount).toBe(1);
      expect(shell.verifiedCount).toBe(1);
      expect(shell.failedCount).toBe(1);
      // paused nodes are intentionally excluded from all summary counts
    });
  });

  describe("shell snapshot includes weave run summaries", () => {
    it("engine read model includes weave run with status=draft after weave.create", async () => {
      // This verifies the data that buildWeaveRunShell (in ws.ts subscribeShell) consumes.
      // The shell snapshot augments the SQL-backed snapshot with in-memory weaveRuns from
      // orchestrationEngine.getReadModel().weaveRuns — this test asserts that map has the
      // correct projection after a weave.create dispatch.
      const system = await createOrchestrationSystem();
      try {
        const weaveRunId = WeaveRunId.make("shell-snapshot-test-run");
        const projectId = ProjectId.make("shell-snapshot-test-project");
        const createdAt = now();

        // Before create: weaveRuns map is empty.
        const before = await system.run(system.engine.getReadModel());
        expect(before.weaveRuns.size).toBe(0);

        // Dispatch weave.create.
        await system.run(
          system.engine.dispatch({
            type: "weave.create",
            commandId: CommandId.make("shell-snapshot-cmd"),
            weaveRunId,
            projectId,
            title: "Shell Snapshot Test Weave",
            vision: "shell snapshot test vision",
            createdAt,
          }),
        );

        // After create: weaveRuns map has one entry with the correct fields.
        const after = await system.run(system.engine.getReadModel());
        expect(after.weaveRuns.size).toBe(1);

        const projection = after.weaveRuns.get(weaveRunId);
        expect(projection).toBeDefined();
        expect(projection?.run.id).toBe(weaveRunId);
        expect(projection?.run.projectId).toBe(projectId);
        expect(projection?.run.title).toBe("Shell Snapshot Test Weave");
        expect(projection?.run.status).toBe("draft");
        expect(projection?.run.createdAt).toBe(createdAt);
        // No node meta yet — all counts would be 0 in the shell summary.
        expect(projection?.nodeMeta.size).toBe(0);
      } finally {
        await system.dispose();
      }
    });
  });

  describe("weave.delete dispatch removes the run from the read model", () => {
    it("dispatches weave.delete and the projection becomes null", async () => {
      const system = await createOrchestrationSystem();
      try {
        const weaveRunId = WeaveRunId.make("delete-test-run");
        const projectId = ProjectId.make("delete-test-project");

        await system.run(
          system.engine.dispatch({
            type: "weave.create",
            commandId: CommandId.make("cmd-create-del"),
            weaveRunId,
            projectId,
            title: "To be deleted",
            vision: "",
            createdAt: now(),
          }),
        );

        const before = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
        expect(before).not.toBeNull();

        const result = await system.run(
          system.engine.dispatch({
            type: "weave.delete",
            commandId: CommandId.make("cmd-delete"),
            weaveRunId,
            createdAt: now(),
          }),
        );
        expect(result.sequence).toBeGreaterThan(0);

        const after = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
        expect(after).toBeNull();
      } finally {
        await system.dispose();
      }
    });

    it("rejects weave.delete for a non-existent run", async () => {
      const system = await createOrchestrationSystem();
      try {
        await expect(
          system.run(
            system.engine.dispatch({
              type: "weave.delete",
              commandId: CommandId.make("cmd-delete-missing"),
              weaveRunId: WeaveRunId.make("never-existed"),
              createdAt: now(),
            }),
          ),
        ).rejects.toThrow();
      } finally {
        await system.dispose();
      }
    });
  });
});
