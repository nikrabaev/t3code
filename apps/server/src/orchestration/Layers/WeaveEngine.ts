import { BlueprintVersion, EventId } from "@t3tools/contracts";
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

    const persistPlannerEvent: WeaveEngineShape["persistPlannerEvent"] = (input) => {
      const occurredAt = new Date().toISOString();
      // Version is 1 for the initial planner compile; amendment/redesign
      // increments would look at the existing blueprint version — for now
      // the planner only handles "initial" (compiledBy: "planner").
      const version = BlueprintVersion.make(1);
      const event = {
        eventId: EventId.make(crypto.randomUUID()),
        aggregateKind: "weave" as const,
        aggregateId: input.runId,
        type: "weave.blueprint-compiled" as const,
        occurredAt,
        commandId: null,
        causationEventId: null,
        correlationId: input.correlationCommandId ?? null,
        metadata: {},
        payload: {
          weaveRunId: input.runId,
          version,
          blueprint: { ...input.blueprint, version },
          compiledBy: input.compiledBy,
          occurredAt,
        },
      };
      return engine.appendSystemEvent(event);
    };

    return {
      dispatchWeaveCommand,
      getWeaveRun,
      persistPlannerEvent,
      get streamWeaveEvents() {
        return engine.streamDomainEvents.pipe(
          Stream.filter((e): e is WeaveOrchestrationEvent => e.type.startsWith("weave.")),
        );
      },
    } satisfies WeaveEngineShape;
  }),
);
