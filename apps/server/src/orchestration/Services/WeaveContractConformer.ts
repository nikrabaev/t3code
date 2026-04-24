/**
 * WeaveContractConformer - Naive test-verifier for Weave child threads.
 *
 * Subscribes to the RuntimeReceiptBus and filters for
 * `turn.processing.quiesced` receipts. For each receipt it checks whether the
 * thread belongs to a Weave child node (via a reverse lookup through
 * `weaveRuns.childThreads`). If it does, it runs `bun run test` in the node's
 * worktree and dispatches either `weave.node.verified` (exit 0) or
 * `weave.node.failed` (non-zero exit or timeout).
 *
 * @module WeaveContractConformer
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface WeaveContractConformerShape {
  /**
   * Start the conformer event loop.
   *
   * Subscribes to the RuntimeReceiptBus and forks a worker into the current
   * scope. The scope must remain open for the lifetime of the server.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal work queue is empty and no item is being
   * processed. Use in tests for deterministic drain-before-assert patterns.
   */
  readonly drain: Effect.Effect<void>;
}

export class WeaveContractConformer extends Context.Service<
  WeaveContractConformer,
  WeaveContractConformerShape
>()("t3/orchestration/Services/WeaveContractConformer") {}
