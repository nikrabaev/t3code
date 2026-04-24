import { Effect, Layer, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { WeaveEngineService, type WeaveEngineShape } from "../Services/WeaveEngine.ts";
import type { WeaveOrchestrationEvent } from "../weaveProjector.ts";

export const WeaveEngineLive = Layer.effect(
  WeaveEngineService,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;

    const dispatchWeaveCommand: WeaveEngineShape["dispatchWeaveCommand"] = (command) =>
      engine.dispatch(command);

    const getWeaveRun: WeaveEngineShape["getWeaveRun"] = (runId) =>
      engine.getReadModel().pipe(Effect.map((model) => model.weaveRuns.get(runId) ?? null));

    return {
      dispatchWeaveCommand,
      getWeaveRun,
      get streamWeaveEvents() {
        return engine.streamDomainEvents.pipe(
          Stream.filter((e): e is WeaveOrchestrationEvent => e.type.startsWith("weave.")),
        );
      },
    } satisfies WeaveEngineShape;
  }),
);
