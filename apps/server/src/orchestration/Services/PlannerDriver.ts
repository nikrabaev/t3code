/**
 * PlannerDriver - Abstraction layer for WeavePlanner's LLM backend.
 *
 * Separates the planner loop (subscribe → compile → decode → persist) from
 * the concrete provider invocation so that tests can inject a stub without
 * standing up the full ProviderService stack.
 *
 * The default PlannerDriverLive layer is a placeholder; real provider
 * integration ships in Slice 4.
 *
 * @module PlannerDriver
 */
import { Context, Data } from "effect";
import type { Effect } from "effect";

export class PlannerDriverError extends Data.TaggedError("PlannerDriverError")<{
  readonly reason: string;
}> {}

export interface PlannerDriverShape {
  /**
   * Invoke the planner and return raw JSON text for a Blueprint.
   *
   * @param input.vision - The user's stated goal.
   * @param input.snapshotContent - Serialized codebase snapshot (may be empty).
   * @param input.previousError - When retrying, the error from the previous attempt.
   */
  readonly compile: (input: {
    readonly vision: string;
    readonly snapshotContent: string;
    readonly previousError?: string;
  }) => Effect.Effect<string, PlannerDriverError>;
}

export class PlannerDriver extends Context.Service<PlannerDriver, PlannerDriverShape>()(
  "t3/orchestration/Services/PlannerDriver",
) {}
