/**
 * WeaveContractConformerLive - Layer implementation of WeaveContractConformer.
 *
 * Processing triggers:
 *  - `thread.session-set` where the new session reports `status === "ready"`
 *    and `activeTurnId === null` — the LLM and harness have ended their
 *    turns and the child thread is no longer running. This is what we want;
 *    earlier signals (e.g. `turn.processing.quiesced`) fire mid-conversation
 *    on multi-turn agents and would run the verifier prematurely.
 *  - `weave.node-retry-requested` — the user clicked Retry on a failed node.
 *    Re-runs the verifier in the existing worktree without re-dispatching
 *    the agent.
 *
 * Per trigger:
 *  1. Resolve the (weaveRunId, nodeId, worktreePath) for the trigger.
 *  2. If no match (non-weave thread for the session-set trigger), skip.
 *  3. Resolve the verifier command (node override → project default →
 *     hardcoded `bun run test`) and run it in the node's worktree path
 *     (capped at 120 seconds). Argv split is whitespace-only; users with
 *     complex shell pipelines should wrap them in a script.
 *  4. Exit 0   → dispatch `weave.node.verified`.
 *     Non-zero  → dispatch `weave.node.failed` with exit code in reason.
 *     Timeout   → dispatch `weave.node.failed` with reason "timeout".
 *
 * @module WeaveContractConformerLive
 */
import { CommandId, WeaveNodeId, WeaveRunId, type ProjectId } from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { ProcessRunner } from "../Services/ProcessRunner.ts";
import {
  WeaveContractConformer,
  type WeaveContractConformerShape,
} from "../Services/WeaveContractConformer.ts";

const VERIFIER_TIMEOUT_MS = 120_000;
const DEFAULT_VERIFIER_COMMAND = "npm run test";
const FAILURE_OUTPUT_BYTE_CAP = 16 * 1024;

/**
 * Combine stdout + stderr into one block for the failure event payload.
 * Trims to the trailing FAILURE_OUTPUT_BYTE_CAP bytes (the tail usually has
 * the failing assertion/stack), and prepends a marker when truncation
 * happened either at the underlying buffer or by this cap.
 */
function buildFailureOutput(result: {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}): string | undefined {
  const sections: string[] = [];
  if (result.stderr.length > 0) {
    sections.push(`--- stderr ---\n${result.stderr}`);
  }
  if (result.stdout.length > 0) {
    sections.push(`--- stdout ---\n${result.stdout}`);
  }
  if (sections.length === 0) {
    return undefined;
  }
  const joined = sections.join("\n");
  const upstreamTruncated = result.stdoutTruncated || result.stderrTruncated;
  if (joined.length <= FAILURE_OUTPUT_BYTE_CAP) {
    return upstreamTruncated ? `[truncated upstream]\n${joined}` : joined;
  }
  const tail = joined.slice(joined.length - FAILURE_OUTPUT_BYTE_CAP);
  const prefix = upstreamTruncated
    ? "[truncated upstream + tail-only here]\n"
    : "[truncated — tail only]\n";
  return `${prefix}${tail}`;
}

const serverCommandId = (): CommandId => CommandId.make(`server:conformer:${crypto.randomUUID()}`);

/**
 * Split a verifier command string into argv. Whitespace-only — quoting and
 * shell metacharacters are not handled. Users with complex commands should
 * wrap them in a script the project knows how to invoke.
 *
 * Exported for unit testing.
 */
export function splitVerifierCommand(command: string): { command: string; args: string[] } {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new Error(`splitVerifierCommand: empty command "${command}"`);
  }
  const [head, ...args] = tokens;
  return { command: head!, args };
}

// ── Reverse-lookup helper ─────────────────────────────────────────────────────

/**
 * Search all weave runs for a child thread matching `threadId`.
 * Returns `{ weaveRunId, nodeId, worktreePath }` or `null` when the thread
 * does not belong to any weave node.
 *
 * Complexity: O(runs × nodes per run) — acceptable for v0.1.
 */
type WeaveRunsForLookup = ReadonlyMap<
  WeaveRunId,
  {
    readonly run: { readonly projectId: ProjectId };
    readonly currentBlueprint: {
      readonly nodes: ReadonlyArray<{
        readonly id: WeaveNodeId;
        readonly verifierCommand?: string | undefined;
      }>;
    } | null;
    readonly childThreads: ReadonlyMap<
      WeaveNodeId,
      { readonly threadId: string; readonly worktreePath: string }
    >;
  }
>;

interface NodeLookup {
  readonly weaveRunId: WeaveRunId;
  readonly nodeId: WeaveNodeId;
  readonly threadId: string;
  readonly worktreePath: string;
  readonly projectId: ProjectId;
  readonly nodeVerifierCommand: string | null;
}

function findWeaveNodeForThread(
  weaveRuns: WeaveRunsForLookup,
  threadId: string,
): NodeLookup | null {
  for (const [weaveRunId, run] of weaveRuns) {
    for (const [nodeId, entry] of run.childThreads) {
      if (entry.threadId === threadId) {
        const node = run.currentBlueprint?.nodes.find((n) => n.id === nodeId) ?? null;
        return {
          weaveRunId,
          nodeId,
          threadId,
          worktreePath: entry.worktreePath,
          projectId: run.run.projectId,
          nodeVerifierCommand: node?.verifierCommand ?? null,
        };
      }
    }
  }
  return null;
}

function findWeaveNodeById(
  weaveRuns: WeaveRunsForLookup,
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
): NodeLookup | null {
  const run = weaveRuns.get(weaveRunId);
  if (!run) return null;
  const child = run.childThreads.get(nodeId);
  if (!child) return null;
  const node = run.currentBlueprint?.nodes.find((n) => n.id === nodeId) ?? null;
  return {
    weaveRunId,
    nodeId,
    threadId: child.threadId,
    worktreePath: child.worktreePath,
    projectId: run.run.projectId,
    nodeVerifierCommand: node?.verifierCommand ?? null,
  };
}

// ── Trigger union ─────────────────────────────────────────────────────────────

type ConformerTrigger =
  | { readonly kind: "session-ready"; readonly threadId: string }
  | { readonly kind: "retry"; readonly weaveRunId: WeaveRunId; readonly nodeId: WeaveNodeId };

// ── Layer ─────────────────────────────────────────────────────────────────────

const make = Effect.gen(function* () {
  const weaveEngine = yield* WeaveEngineService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const processRunner = yield* ProcessRunner;

  const processItem = (trigger: ConformerTrigger) =>
    Effect.gen(function* () {
      // Step 1: find the weave node either by thread id (session-ready) or by
      // run+node id (retry-requested).
      const readModel = yield* orchestrationEngine.getReadModel();
      const match =
        trigger.kind === "session-ready"
          ? findWeaveNodeForThread(readModel.weaveRuns, trigger.threadId)
          : findWeaveNodeById(readModel.weaveRuns, trigger.weaveRunId, trigger.nodeId);

      if (match === null) {
        if (trigger.kind === "session-ready") {
          // Not a weave child thread — skip silently.
          yield* Effect.log("WeaveContractConformer: non-weave thread, skipping", {
            threadId: trigger.threadId,
          });
        } else {
          yield* Effect.logWarning("WeaveContractConformer: retry target not found", {
            weaveRunId: trigger.weaveRunId,
            nodeId: trigger.nodeId,
          });
        }
        return;
      }

      // Skip if the node isn't currently running (e.g. status flipped to
      // verified/failed concurrently). Only running nodes need verification.
      const currentMeta = readModel.weaveRuns.get(match.weaveRunId)?.nodeMeta.get(match.nodeId);
      if (currentMeta?.status !== "running") {
        yield* Effect.log("WeaveContractConformer: node not running, skipping", {
          weaveRunId: match.weaveRunId,
          nodeId: match.nodeId,
          status: currentMeta?.status ?? "unknown",
          triggerKind: trigger.kind,
        });
        return;
      }

      const { weaveRunId, nodeId, threadId, worktreePath, projectId, nodeVerifierCommand } = match;

      // Step 2: resolve the verifier command — node override beats project
      // default beats the hardcoded fallback.
      const project = readModel.projects.find((p) => p.id === projectId) ?? null;
      const projectVerifierCommand = project?.verifierCommand ?? null;
      const resolvedCommand =
        nodeVerifierCommand ?? projectVerifierCommand ?? DEFAULT_VERIFIER_COMMAND;
      const { command, args } = splitVerifierCommand(resolvedCommand);

      yield* Effect.log("WeaveContractConformer: running verifier in worktree", {
        threadId,
        weaveRunId,
        nodeId,
        worktreePath,
        verifierCommand: resolvedCommand,
        verifierSource: nodeVerifierCommand
          ? "node"
          : projectVerifierCommand
            ? "project"
            : "default",
        triggerKind: trigger.kind,
      });

      // Step 3: run the verifier.
      const result = yield* processRunner.run({
        command,
        args,
        cwd: worktreePath,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });

      const createdAt = new Date().toISOString();

      // Step 4: dispatch the outcome command.
      const failureOutput = buildFailureOutput(result);

      if (result.timedOut) {
        yield* Effect.log("WeaveContractConformer: verifier timed out", {
          weaveRunId,
          nodeId,
          worktreePath,
          verifierCommand: resolvedCommand,
          ...(failureOutput !== undefined ? { failureOutput } : {}),
        });
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId,
          nodeId,
          reason: "timeout",
          ...(failureOutput !== undefined ? { failureOutput } : {}),
          createdAt,
        });
        return;
      }

      if (result.exitCode === 0) {
        yield* Effect.log("WeaveContractConformer: verifier passed", {
          weaveRunId,
          nodeId,
          verifierCommand: resolvedCommand,
        });
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.node.verified",
          commandId: serverCommandId(),
          weaveRunId,
          nodeId,
          verifierOutcome: `${resolvedCommand} exit 0`,
          createdAt,
        });
      } else {
        yield* Effect.log("WeaveContractConformer: verifier failed", {
          weaveRunId,
          nodeId,
          exitCode: result.exitCode,
          verifierCommand: resolvedCommand,
          ...(failureOutput !== undefined ? { failureOutput } : {}),
        });
        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId,
          nodeId,
          reason: `${resolvedCommand} exit ${result.exitCode}`,
          ...(failureOutput !== undefined ? { failureOutput } : {}),
          createdAt,
        });
      }
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logError("WeaveContractConformer: unexpected error processing trigger", {
          trigger,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processItem);

  const start: WeaveContractConformerShape["start"] = () =>
    Effect.gen(function* () {
      // thread.session-set with status === "ready" + activeTurnId null —
      // the LLM and harness ended their turns. This is the "agent truly
      // done" hook; turn.processing.quiesced fired mid-conversation on
      // multi-turn agents and would run the verifier prematurely.
      yield* Effect.forkScoped(
        Stream.runForEach(
          orchestrationEngine.streamDomainEvents.pipe(
            Stream.filter(
              (e) =>
                e.type === "thread.session-set" &&
                e.payload.session.status === "ready" &&
                e.payload.session.activeTurnId === null,
            ),
          ),
          (event) =>
            event.type === "thread.session-set"
              ? worker.enqueue({
                  kind: "session-ready" as const,
                  threadId: event.payload.threadId,
                })
              : Effect.void,
        ),
      );
      // weave.node-retry-requested — user asked to re-run the verifier on a
      // failed node without re-dispatching the agent.
      yield* Effect.forkScoped(
        Stream.runForEach(
          weaveEngine.streamWeaveEvents.pipe(
            Stream.filter((e) => e.type === "weave.node-retry-requested"),
          ),
          (event) =>
            worker.enqueue({
              kind: "retry" as const,
              weaveRunId: event.payload.weaveRunId,
              nodeId: event.payload.nodeId,
            }),
        ),
      );
    });

  return {
    start,
    drain: worker.drain,
  } satisfies WeaveContractConformerShape;
});

export const WeaveContractConformerLive = Layer.effect(WeaveContractConformer, make);
