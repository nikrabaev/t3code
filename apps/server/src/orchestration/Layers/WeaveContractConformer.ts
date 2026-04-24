/**
 * WeaveContractConformerLive - Layer implementation of WeaveContractConformer.
 *
 * Processing loop (per turn.processing.quiesced receipt):
 *  1. Fetch the current read model and reverse-lookup the thread ID across all
 *     weave runs via `childThreads`. O(runs × nodes) — acceptable for v0.1.
 *  2. If no match, skip (non-weave thread).
 *  3. Run `bun run test` in the node's worktree path (capped at 120 seconds).
 *  4. Exit 0   → dispatch `weave.node.verified`.
 *     Non-zero  → dispatch `weave.node.failed` with exit code in reason.
 *     Timeout   → dispatch `weave.node.failed` with reason "timeout".
 *
 * @module WeaveContractConformerLive
 */
import { CommandId, WeaveNodeId, WeaveRunId } from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { ProcessRunner } from "../Services/ProcessRunner.ts";
import {
  WeaveContractConformer,
  type WeaveContractConformerShape,
} from "../Services/WeaveContractConformer.ts";
import type { TurnProcessingQuiescedReceipt } from "../Services/RuntimeReceiptBus.ts";

const VERIFIER_TIMEOUT_MS = 120_000;

const serverCommandId = (): CommandId => CommandId.make(`server:conformer:${crypto.randomUUID()}`);

// ── Reverse-lookup helper ─────────────────────────────────────────────────────

/**
 * Search all weave runs for a child thread matching `threadId`.
 * Returns `{ weaveRunId, nodeId, worktreePath }` or `null` when the thread
 * does not belong to any weave node.
 *
 * Complexity: O(runs × nodes per run) — acceptable for v0.1.
 */
function findWeaveNodeForThread(
  weaveRuns: ReadonlyMap<
    WeaveRunId,
    {
      readonly childThreads: ReadonlyMap<
        WeaveNodeId,
        { readonly threadId: string; readonly worktreePath: string }
      >;
    }
  >,
  threadId: string,
): { weaveRunId: WeaveRunId; nodeId: WeaveNodeId; worktreePath: string } | null {
  for (const [weaveRunId, run] of weaveRuns) {
    for (const [nodeId, entry] of run.childThreads) {
      if (entry.threadId === threadId) {
        return { weaveRunId, nodeId, worktreePath: entry.worktreePath };
      }
    }
  }
  return null;
}

// ── Layer ─────────────────────────────────────────────────────────────────────

const make = Effect.gen(function* () {
  const receiptBus = yield* RuntimeReceiptBus;
  const weaveEngine = yield* WeaveEngineService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processRunner = yield* ProcessRunner;

  const processItem = (receipt: TurnProcessingQuiescedReceipt) =>
    Effect.gen(function* () {
      // Step 1: find which weave node (if any) owns this thread.
      const readModel = yield* orchestrationEngine.getReadModel();
      const match = findWeaveNodeForThread(readModel.weaveRuns, receipt.threadId);

      if (match === null) {
        // Not a weave child thread — skip silently.
        yield* Effect.log("WeaveContractConformer: non-weave thread, skipping", {
          threadId: receipt.threadId,
        });
        return;
      }

      const { weaveRunId, nodeId, worktreePath } = match;

      yield* Effect.log("WeaveContractConformer: running bun test in worktree", {
        threadId: receipt.threadId,
        weaveRunId,
        nodeId,
        worktreePath,
      });

      // Step 2: run the verifier.
      const result = yield* processRunner.run({
        command: "bun",
        args: ["run", "test"],
        cwd: worktreePath,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });

      const createdAt = new Date().toISOString();

      // Step 3: dispatch the outcome command.
      if (result.timedOut) {
        yield* Effect.log("WeaveContractConformer: bun test timed out", {
          weaveRunId,
          nodeId,
          worktreePath,
        });
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId,
          nodeId,
          reason: "timeout",
          createdAt,
        });
        return;
      }

      if (result.exitCode === 0) {
        yield* Effect.log("WeaveContractConformer: bun test passed", {
          weaveRunId,
          nodeId,
        });
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.node.verified",
          commandId: serverCommandId(),
          weaveRunId,
          nodeId,
          verifierOutcome: "bun run test exit 0",
          createdAt,
        });
      } else {
        yield* Effect.log("WeaveContractConformer: bun test failed", {
          weaveRunId,
          nodeId,
          exitCode: result.exitCode,
        });
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId,
          nodeId,
          reason: `bun run test exit ${result.exitCode}`,
          createdAt,
        });
      }
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logError("WeaveContractConformer: unexpected error processing receipt", {
          threadId: receipt.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processItem);

  const start: WeaveContractConformerShape["start"] = () =>
    Effect.forkScoped(
      Stream.runForEach(
        receiptBus.streamEventsForTest.pipe(
          Stream.filter(
            (e): e is TurnProcessingQuiescedReceipt => e.type === "turn.processing.quiesced",
          ),
        ),
        (receipt) => worker.enqueue(receipt),
      ),
    ).pipe(Effect.asVoid);

  return {
    start,
    drain: worker.drain,
  } satisfies WeaveContractConformerShape;
});

export const WeaveContractConformerLive = Layer.effect(WeaveContractConformer, make);
