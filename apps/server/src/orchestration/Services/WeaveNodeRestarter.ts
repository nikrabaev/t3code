/**
 * WeaveNodeRestarter - Re-dispatch the agent on a failed Weave node.
 *
 * Subscribes to `weave.node-restart-requested` events and sends a fresh
 * `thread.turn.start` to the existing child thread so the agent gets another
 * attempt at the task. The worktree and child thread are reused; only a new
 * turn is started. The verifier fires automatically when the new turn quiesces
 * (driven by WeaveContractConformer).
 *
 * @module WeaveNodeRestarter
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface WeaveNodeRestarterShape {
  /**
   * Start the restarter event loop. Forks a worker into the current scope; the
   * scope must remain open for the lifetime of the server.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal queue is drained. Useful in tests.
   */
  readonly drain: Effect.Effect<void>;
}

export class WeaveNodeRestarter extends Context.Service<
  WeaveNodeRestarter,
  WeaveNodeRestarterShape
>()("t3/orchestration/Services/WeaveNodeRestarter") {}
