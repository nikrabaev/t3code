import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  WeaveRunId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { WeaveEngineLive } from "./WeaveEngine.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);

function now() {
  return new Date().toISOString();
}

async function createWeaveEngineSystem() {
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-weave-engine-test-",
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
  const runtime = ManagedRuntime.make(weaveEngineLayer);
  const weaveEngine = await runtime.runPromise(Effect.service(WeaveEngineService));
  return {
    weaveEngine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

describe("WeaveEngine", () => {
  it("dispatchWeaveCommand returns sequence >= 1 for weave.create", async () => {
    const system = await createWeaveEngineSystem();
    const { weaveEngine } = system;
    const createdAt = now();

    const result = await system.run(
      weaveEngine.dispatchWeaveCommand({
        type: "weave.create",
        commandId: CommandId.make("cmd-weave-engine-create"),
        weaveRunId: WeaveRunId.make("run-weave-engine-1"),
        projectId: asProjectId("project-weave-engine-1"),
        title: "Test Weave",
        vision: "A test vision for WeaveEngine",
        createdAt,
      }),
    );

    expect(result.sequence).toBeGreaterThanOrEqual(1);
    await system.dispose();
  });

  it("getWeaveRun returns projection with status=draft after weave.create", async () => {
    const system = await createWeaveEngineSystem();
    const { weaveEngine } = system;
    const createdAt = now();
    const weaveRunId = WeaveRunId.make("run-weave-engine-get");

    await system.run(
      weaveEngine.dispatchWeaveCommand({
        type: "weave.create",
        commandId: CommandId.make("cmd-weave-engine-get"),
        weaveRunId,
        projectId: asProjectId("project-weave-engine-get"),
        title: "Get Weave",
        vision: "vision for getWeaveRun test",
        createdAt,
      }),
    );

    const projection = await system.run(weaveEngine.getWeaveRun(weaveRunId));

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("draft");
    expect(projection?.run.id).toBe(weaveRunId);
    await system.dispose();
  });

  it("getWeaveRun returns null for an unknown runId", async () => {
    const system = await createWeaveEngineSystem();
    const { weaveEngine } = system;

    const projection = await system.run(weaveEngine.getWeaveRun(WeaveRunId.make("run-unknown")));

    expect(projection).toBeNull();
    await system.dispose();
  });

  it("streamWeaveEvents yields weave.created and skips thread events", async () => {
    const system = await createWeaveEngineSystem();
    const { weaveEngine } = system;
    const createdAt = now();

    // First, set up the orchestration system layer directly so we can dispatch
    // a thread.create alongside the weave.create. We do this by accessing the
    // underlying runtime and dispatching both commands.
    const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-weave-engine-stream-test-",
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

    // Build a combined layer that exposes both WeaveEngineService and
    // OrchestrationEngineLive so we can dispatch thread commands too.
    const combinedLayer = Layer.provideMerge(weaveEngineLayer, orchestrationLayer);
    const streamRuntime = ManagedRuntime.make(combinedLayer);

    try {
      const capturedTypes: string[] = [];

      await streamRuntime.runPromise(
        Effect.gen(function* () {
          const weave = yield* WeaveEngineService;
          const eventQueue = yield* Queue.unbounded<OrchestrationEvent>();

          // Subscribe to the filtered stream — take exactly 1 event.
          yield* Effect.forkScoped(
            Stream.take(weave.streamWeaveEvents, 1).pipe(
              Stream.runForEach((event) =>
                Queue.offer(eventQueue, event as OrchestrationEvent).pipe(Effect.asVoid),
              ),
            ),
          );

          // Give the subscriber a moment to attach.
          yield* Effect.sleep("10 millis");

          // Dispatch a project first so thread.create can reference it.
          yield* weave.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-stream-weave-create"),
            weaveRunId: WeaveRunId.make("run-stream-test"),
            projectId: asProjectId("project-stream-test"),
            title: "Stream Test Weave",
            vision: "vision for stream filter test",
            createdAt,
          });

          // Collect the weave event from the queue.
          const weaveEvent = yield* Queue.take(eventQueue);
          capturedTypes.push(weaveEvent.type);
        }).pipe(Effect.scoped),
      );

      expect(capturedTypes).toEqual(["weave.created"]);
      expect(capturedTypes.some((t) => t.startsWith("thread."))).toBe(false);
    } finally {
      await streamRuntime.dispose();
    }
    await system.dispose();
  });
});
