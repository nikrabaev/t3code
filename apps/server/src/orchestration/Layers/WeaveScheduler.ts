/**
 * WeaveSchedulerLive - Layer implementation of the WeaveScheduler service.
 *
 * Processing loop (per weave.blueprint-approved or weave.node-verified event):
 *  1. Fetch the current WeaveRunProjection.
 *  2. Compute ready set: nodes in "pending" status whose dependsOn are all "verified".
 *  3. Pick next by phase ordinal ascending, node-id tiebreak.
 *  4. Allocate a worktree via GitCore.createWorktree on a new branch off "main".
 *  5. Create a child thread via OrchestrationEngineService.dispatch("thread.create").
 *  6. Dispatch weave.node.dispatch via WeaveEngineService.dispatchWeaveCommand.
 *  7. Start the child thread turn via OrchestrationEngineService.dispatch("thread.turn.start").
 *
 * v0.1 shortcut: skips the pending→ready transition. Decider accepts "pending" for dispatch.
 * See docs/superpowers/followups/2026-04-24-reintroduce-weave-node-ready-transition.md
 *
 * @module WeaveSchedulerLive
 */
import type { WeaveNode, WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";
import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { GitCore } from "../../git/Services/GitCore.ts";
import type { GitCommandError } from "@t3tools/contracts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { WeaveEngineService, type WeaveEngineShape } from "../Services/WeaveEngine.ts";
import { WeaveScheduler, type WeaveSchedulerShape } from "../Services/WeaveScheduler.ts";
import type { WeaveOrchestrationEvent } from "../weaveProjector.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const serverCommandId = (): CommandId => CommandId.make(`server:scheduler:${crypto.randomUUID()}`);

type SchedulerTriggerEvent = Extract<
  WeaveOrchestrationEvent,
  { type: "weave.blueprint-approved" | "weave.node-verified" }
>;

/**
 * Compute the set of nodes that are ready to be dispatched:
 * - Node status is "pending"
 * - All declared dependencies are "verified"
 */
function computeReadySet(run: WeaveRunProjection): WeaveNode[] {
  if (run.currentBlueprint === null) return [];
  return run.currentBlueprint.nodes.filter((n) => {
    if (run.nodeMeta.get(n.id)?.status !== "pending") return false;
    return n.dependsOn.every((dep) => run.nodeMeta.get(dep)?.status === "verified");
  });
}

/**
 * Pick the next node to dispatch: sort by phase ordinal ascending, then node id
 * as a stable tiebreak.
 */
function pickNext(
  readySet: WeaveNode[],
  blueprint: WeaveRunProjection["currentBlueprint"],
): WeaveNode | undefined {
  if (readySet.length === 0 || blueprint === null) return undefined;

  const phaseOrdinalMap = new Map<string, number>();
  for (const phase of blueprint.phases) {
    phaseOrdinalMap.set(phase.id, phase.ordinal);
  }

  const sorted = [...readySet].sort((a, b) => {
    const aOrdinal = phaseOrdinalMap.get(a.phaseId) ?? 0;
    const bOrdinal = phaseOrdinalMap.get(b.phaseId) ?? 0;
    if (aOrdinal !== bOrdinal) return aOrdinal - bOrdinal;
    // tiebreak by node id string comparison
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0];
}

/**
 * Convert a node id to a branch-name-safe slug.
 * Note: slug alone does not guarantee uniqueness across distinct node IDs
 * (e.g. "Implement Auth" and "implement_auth" both become "implement-auth").
 * Collisions are resolved by the hash suffix appended in `buildBranchName`.
 */
function slugifyNodeId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Compute a 6-character deterministic hex hash of the input using DJB2.
 * Used to disambiguate branch names when slugified node IDs collide.
 */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Build a git branch name for a node that is guaranteed unique within a run,
 * even when two node IDs share the same slug.
 */
function buildBranchName(runId: string, nodeId: WeaveNodeId): string {
  return `weave-${runId.slice(0, 8)}-${slugifyNodeId(nodeId)}-${shortHash(nodeId)}`;
}

/**
 * Format the node spec as the user message text for the child thread turn.
 *
 * Exported so the WeaveNodeRestarter reactor uses the same prompt when
 * re-dispatching the agent on a failed node.
 */
export function formatNodeSpec(node: WeaveNode): string {
  const lines: string[] = [`# Task: ${node.title}`, ""];
  if (node.description.trim().length > 0) {
    lines.push(node.description, "");
  }
  if (node.verifierDescription.trim().length > 0) {
    lines.push("## Verifier", node.verifierDescription, "");
  }
  return lines.join("\n").trimEnd();
}

// ── Main effect ───────────────────────────────────────────────────────────────

const processSchedulerDecision = Effect.fn("WeaveScheduler.processSchedulerDecision")(function* (
  event: SchedulerTriggerEvent,
  weaveEngine: WeaveEngineShape,
  orchestrationEngine: ReturnType<typeof OrchestrationEngineService.of>,
  git: ReturnType<typeof GitCore.of>,
) {
  const runId = event.payload.weaveRunId;
  const run = yield* weaveEngine.getWeaveRun(runId);

  if (run === null || run.currentBlueprint === null) {
    yield* Effect.log("WeaveScheduler: skipping — run or blueprint not found", { runId });
    return;
  }
  if (run.run.status !== "running") {
    yield* Effect.log("WeaveScheduler: skipping — run not in running state", {
      runId,
      status: run.run.status,
    });
    return;
  }

  const readySet = computeReadySet(run);
  if (readySet.length === 0) {
    yield* Effect.log("WeaveScheduler: no nodes ready to dispatch", { runId });
    return;
  }

  const next = pickNext(readySet, run.currentBlueprint);
  if (next === undefined) return;

  yield* Effect.log("WeaveScheduler: dispatching node", { runId, nodeId: next.id });

  // Look up the project's workspace root and default model selection from the read model.
  const readModel = yield* orchestrationEngine.getReadModel();
  const project = readModel.projects.find((p) => p.id === run.run.projectId);
  if (project === undefined) {
    yield* Effect.logError("WeaveScheduler: project not found in read model", {
      runId,
      projectId: run.run.projectId,
    });
    return;
  }

  const workspaceRoot = project.workspaceRoot;

  // Resolve the model selection: use project default if set, otherwise fall
  // back to the codex default (same logic as serverRuntimeStartup.ts).
  const modelSelection: ModelSelection = project.defaultModelSelection ?? {
    provider: "codex",
    model: DEFAULT_MODEL_BY_PROVIDER.codex,
  };

  // Build a safe branch name — includes a 6-char hash suffix to prevent
  // collisions between node IDs that share the same slug.
  const branchName = buildBranchName(runId, next.id);

  // Allocate the worktree. Use HEAD as the base ref so the new branch is
  // created from whatever the project's current branch is, regardless of
  // its name (main / master / dev / anything else). The repo must have at
  // least one commit; if not, fail the node with a friendly reason rather
  // than letting the raw git error abort the entire run.
  type WorktreeOutcome =
    | { readonly kind: "ok"; readonly path: string }
    | { readonly kind: "failed"; readonly reason: string };

  const worktreeOutcome: WorktreeOutcome = yield* git
    .createWorktree({
      cwd: workspaceRoot,
      branch: "HEAD",
      newBranch: branchName,
      path: null,
    })
    .pipe(
      Effect.map((result): WorktreeOutcome => ({ kind: "ok", path: result.worktree.path })),
      Effect.catch((error: GitCommandError): Effect.Effect<WorktreeOutcome> => {
        const detail = error.detail ?? "";
        const isUnbornHead = /not a valid object name: 'HEAD'/.test(detail);
        const reason = isUnbornHead
          ? `Project repository has no commits. Make at least one commit in ${workspaceRoot} before running /weave.`
          : `git worktree creation failed: ${error.message}`;
        return Effect.succeed({ kind: "failed", reason });
      }),
    );

  if (worktreeOutcome.kind === "failed") {
    yield* Effect.logError("WeaveScheduler: failing node — worktree creation failed", {
      runId,
      nodeId: next.id,
      reason: worktreeOutcome.reason,
    });
    yield* weaveEngine.dispatchWeaveCommand({
      type: "weave.node.failed",
      commandId: serverCommandId(),
      weaveRunId: runId,
      nodeId: next.id,
      reason: worktreeOutcome.reason,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const worktreePath = worktreeOutcome.path;

  // Create the child thread
  const childThreadId = ThreadId.make(crypto.randomUUID());
  const createdAt = new Date().toISOString();

  yield* orchestrationEngine.dispatch({
    type: "thread.create",
    commandId: serverCommandId(),
    threadId: childThreadId,
    projectId: run.run.projectId,
    title: next.title,
    modelSelection,
    interactionMode: "default",
    runtimeMode: "full-access",
    branch: branchName,
    worktreePath,
    createdAt,
  });

  // Record the dispatch in the weave aggregate
  yield* weaveEngine.dispatchWeaveCommand({
    type: "weave.node.dispatch",
    commandId: serverCommandId(),
    weaveRunId: runId,
    nodeId: next.id,
    childThreadId,
    worktreePath,
    createdAt: new Date().toISOString(),
  });

  // Start the child thread's first turn with the node spec as user message
  yield* orchestrationEngine.dispatch({
    type: "thread.turn.start",
    commandId: serverCommandId(),
    threadId: childThreadId,
    message: {
      messageId: MessageId.make(crypto.randomUUID()),
      role: "user",
      text: formatNodeSpec(next),
      attachments: [],
    },
    interactionMode: "default",
    runtimeMode: "full-access",
    createdAt: new Date().toISOString(),
  });

  yield* Effect.log("WeaveScheduler: node dispatched", {
    runId,
    nodeId: next.id,
    childThreadId,
    worktreePath,
  });
});

// ── Layer ─────────────────────────────────────────────────────────────────────

const make = Effect.gen(function* () {
  const weaveEngine = yield* WeaveEngineService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const git = yield* GitCore;

  const processEvent = (event: SchedulerTriggerEvent) =>
    processSchedulerDecision(event, weaveEngine, orchestrationEngine, git).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logError("WeaveScheduler: unexpected error processing event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEvent);

  const start: WeaveSchedulerShape["start"] = () =>
    Effect.forkScoped(
      Stream.runForEach(
        weaveEngine.streamWeaveEvents.pipe(
          Stream.filter(
            (e): e is SchedulerTriggerEvent =>
              e.type === "weave.blueprint-approved" || e.type === "weave.node-verified",
          ),
        ),
        (event) => worker.enqueue(event),
      ),
    ).pipe(Effect.asVoid);

  return {
    start,
    drain: worker.drain,
  } satisfies WeaveSchedulerShape;
});

export const WeaveSchedulerLive = Layer.effect(WeaveScheduler, make);
