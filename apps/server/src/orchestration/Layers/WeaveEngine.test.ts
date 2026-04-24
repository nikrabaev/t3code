import {
  Blueprint,
  BlueprintVersion,
  CommandId,
  ProjectId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { WeaveEngineLive } from "./WeaveEngine.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);

function now() {
  return new Date().toISOString();
}

function makeSimpleBlueprint(): Blueprint {
  const phaseId = WeavePhaseId.make("phase-simple-1");
  const nodeId = WeaveNodeId.make("node-simple-1");
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: nodeId,
        title: "Simple Node",
        description: "A minimal implementation node",
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

  it("persistPlannerEvent sets status=reviewing and blueprint.version=1", async () => {
    const system = await createWeaveEngineSystem();
    const { weaveEngine } = system;
    const createdAt = now();
    const weaveRunId = WeaveRunId.make("run-persist-planner-1");
    const correlationCommandId = CommandId.make("cmd-persist-planner-1");

    // Materialize the draft projection first.
    await system.run(
      weaveEngine.dispatchWeaveCommand({
        type: "weave.create",
        commandId: correlationCommandId,
        weaveRunId,
        projectId: asProjectId("project-persist-planner-1"),
        title: "Persist Planner Weave",
        vision: "vision for persistPlannerEvent test",
        createdAt,
      }),
    );

    const blueprint = makeSimpleBlueprint();

    await system.run(
      weaveEngine.persistPlannerEvent({
        runId: weaveRunId,
        blueprint,
        compiledBy: "planner",
        correlationCommandId,
      }),
    );

    const projection = await system.run(weaveEngine.getWeaveRun(weaveRunId));

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("reviewing");
    expect(projection?.currentBlueprint?.version).toBe(BlueprintVersion.make(1));
    await system.dispose();
  });

  it("streamWeaveEvents yields weave.created and skips non-weave events", async () => {
    const createdAt = now();

    // Build a layer that exposes both WeaveEngineService and
    // OrchestrationEngineService so we can dispatch both weave and non-weave
    // commands from the same runtime.
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
    const combinedLayer = Layer.provideMerge(weaveEngineLayer, orchestrationLayer);
    const streamRuntime = ManagedRuntime.make(combinedLayer);

    try {
      const weaveEventTypes: string[] = [];

      await streamRuntime.runPromise(
        Effect.gen(function* () {
          const weave = yield* WeaveEngineService;
          const engine = yield* OrchestrationEngineService;
          const weaveQueue = yield* Queue.unbounded<OrchestrationEvent>();

          // Subscribe to the filtered stream — take exactly 1 weave event.
          yield* Effect.forkScoped(
            Stream.take(weave.streamWeaveEvents, 1).pipe(
              Stream.runForEach((event) =>
                Queue.offer(weaveQueue, event as OrchestrationEvent).pipe(Effect.asVoid),
              ),
            ),
          );

          // Give the subscriber a moment to attach.
          yield* Effect.sleep("10 millis");

          // Dispatch a non-weave command (project.create → project.created).
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.make("cmd-stream-project-create"),
            projectId: asProjectId("project-stream-filter-test"),
            title: "Filter Test Project",
            workspaceRoot: "/tmp/project-stream-filter-test",
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt,
          });

          // Dispatch the weave command — this should come through the filtered stream.
          yield* weave.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-stream-weave-create"),
            weaveRunId: WeaveRunId.make("run-stream-test"),
            projectId: asProjectId("project-stream-filter-test"),
            title: "Stream Test Weave",
            vision: "vision for stream filter test",
            createdAt,
          });

          // Collect the one weave event that the filtered stream yields.
          const weaveEvent = yield* Queue.take(weaveQueue);
          weaveEventTypes.push(weaveEvent.type);
        }).pipe(Effect.scoped),
      );

      // The filtered stream must yield weave.created …
      expect(weaveEventTypes).toEqual(["weave.created"]);
      // … and must never leak the non-weave project.created event.
      expect(weaveEventTypes.some((t) => t.startsWith("project."))).toBe(false);
    } finally {
      await streamRuntime.dispose();
    }
  });
});
