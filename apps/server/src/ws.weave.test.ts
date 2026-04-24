import {
  CommandId,
  WeaveRunId,
  ProjectId,
  WeavePhaseId,
  WeaveDecisionId,
  type WeaveDispatchableCommand,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

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
});
