/**
 * WeavePlanner - Service interface for the weave blueprint compilation loop.
 *
 * Subscribes to `weave.created` events via `WeaveEngineService.streamWeaveEvents`,
 * invokes the `PlannerDriver` to compile a Blueprint, decodes the result, and
 * persists it via `WeaveEngineService.persistPlannerEvent`.
 *
 * On JSON parse or Blueprint decode failure the planner retries once with the
 * error context appended. On second failure it dispatches `weave.exit` with
 * `reason: "aborted"`.
 *
 * @module WeavePlanner
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface WeavePlannerShape {
  /**
   * Start the planner event loop.
   *
   * Subscribes to the weave domain-event stream and forks a worker into the
   * current scope. The scope must be open for the lifetime of the server.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal work queue is empty and no item is being
   * processed. Use in tests for deterministic drain-before-assert patterns.
   */
  readonly drain: Effect.Effect<void>;
}

export class WeavePlanner extends Context.Service<WeavePlanner, WeavePlannerShape>()(
  "t3/orchestration/Services/WeavePlanner",
) {}
