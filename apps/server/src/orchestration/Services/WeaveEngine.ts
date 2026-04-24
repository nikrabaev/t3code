/**
 * WeaveEngineService - Thin wrapper over OrchestrationEngineService for weave aggregates.
 */
import type { WeaveCommand, WeaveRunId, WeaveRunProjection } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { OrchestrationDispatchError } from "../Errors.ts";
import type { WeaveOrchestrationEvent } from "../weaveProjector.ts";

export interface WeaveEngineShape {
  readonly dispatchWeaveCommand: (
    command: WeaveCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never>;

  readonly getWeaveRun: (
    runId: WeaveRunId,
  ) => Effect.Effect<WeaveRunProjection | null, never, never>;

  readonly streamWeaveEvents: Stream.Stream<WeaveOrchestrationEvent>;
}

export class WeaveEngineService extends Context.Service<WeaveEngineService, WeaveEngineShape>()(
  "t3/orchestration/Services/WeaveEngine/WeaveEngineService",
) {}
