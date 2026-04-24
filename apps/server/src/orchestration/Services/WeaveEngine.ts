/**
 * WeaveEngineService - Thin wrapper over OrchestrationEngineService for weave aggregates.
 */
import type {
  Blueprint,
  BlueprintSource,
  CommandId,
  WeaveCommand,
  WeaveRunId,
  WeaveRunProjection,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { OrchestrationDispatchError } from "../Errors.ts";
import type { OrchestrationEventStoreError } from "../../persistence/Errors.ts";
import type { WeaveOrchestrationEvent } from "../weaveProjector.ts";

export interface WeaveEngineShape {
  readonly dispatchWeaveCommand: (
    command: WeaveCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never>;

  readonly getWeaveRun: (
    runId: WeaveRunId,
  ) => Effect.Effect<WeaveRunProjection | null, never, never>;

  readonly streamWeaveEvents: Stream.Stream<WeaveOrchestrationEvent>;

  /**
   * Persist a `weave.blueprint-compiled` event directly, bypassing the decider.
   * Used by `WeavePlanner` to record the compiled Blueprint without going through
   * the normal command dispatch path.
   */
  readonly persistPlannerEvent: (input: {
    readonly runId: WeaveRunId;
    readonly blueprint: Blueprint;
    readonly compiledBy: BlueprintSource;
    readonly correlationCommandId?: CommandId;
  }) => Effect.Effect<{ sequence: number }, OrchestrationEventStoreError>;
}

export class WeaveEngineService extends Context.Service<WeaveEngineService, WeaveEngineShape>()(
  "t3/orchestration/Services/WeaveEngine/WeaveEngineService",
) {}
