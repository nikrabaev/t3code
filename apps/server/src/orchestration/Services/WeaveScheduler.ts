/**
 * WeaveScheduler - Service interface for the weave sequential dispatch loop.
 *
 * Subscribes to `weave.blueprint-approved` and `weave.node-verified` events via
 * `WeaveEngineService.streamWeaveEvents`. On each trigger it computes the ready
 * set of nodes (pending nodes whose dependencies are all verified), picks the
 * next one by phase ordinal + node-id tiebreak, allocates a worktree via
 * `GitCore.createWorktree`, creates a child thread via
 * `OrchestrationEngineService.dispatch({ type: "thread.create", ... })`, and
 * dispatches `weave.node.dispatch` + `thread.turn.start` commands.
 *
 * @module WeaveScheduler
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface WeaveSchedulerShape {
  /**
   * Start the scheduler event loop.
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

export class WeaveScheduler extends Context.Service<WeaveScheduler, WeaveSchedulerShape>()(
  "t3/orchestration/Services/WeaveScheduler",
) {}
