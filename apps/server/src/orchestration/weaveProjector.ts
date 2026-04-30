import type {
  IsoDateTime,
  MessageId,
  OrchestrationEvent,
  ProjectId,
  ThreadId,
  WeaveDecisionId,
  WeaveNodeId,
  WeaveNodeMeta,
  WeavePhaseApproval,
  WeavePhaseId,
  WeaveRun,
  WeaveRunId,
  WeaveRunStatus,
  WeaveRunProjection as WeaveRunProjectionFromContracts,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationProjectorDecodeError } from "./Errors.ts";

// WeaveRunProjection is now a contracts-level type (packages/contracts/src/weave.ts).
// Re-exported here so existing importers (weaveDecider.ts, command invariants) are unaffected.
export type WeaveRunProjection = WeaveRunProjectionFromContracts;

// Narrowed weave-only event variants (no sequence field; projector takes a
// fully-envelope'd event since it may need eventId / aggregateId / metadata).
// All weave events have a type starting with "weave." — used as the discriminant
// because aggregateKind is a shared union across all event types (not per-variant).
export type WeaveOrchestrationEvent = Extract<
  OrchestrationEvent,
  { readonly type: `weave.${string}` }
>;

// Factory for an empty projection from a newly-created WeaveRun.
// Used by the `weave.created` case and by test fixtures.
export function createEmptyWeaveProjection(params: {
  readonly id: WeaveRunId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly vision: string;
  readonly parentThreadId?: ThreadId;
  readonly parentMessageId?: MessageId;
  readonly snapshotContent?: string;
  readonly status: WeaveRunStatus;
  readonly concurrencyCap: number;
  readonly planningDepthCap: number;
  readonly createdAt: IsoDateTime;
}): WeaveRunProjection {
  const run: WeaveRun = {
    id: params.id,
    projectId: params.projectId,
    title: params.title,
    vision: params.vision,
    parentThreadId: params.parentThreadId,
    parentMessageId: params.parentMessageId,
    snapshotContent: params.snapshotContent,
    status: params.status,
    concurrencyCap: params.concurrencyCap as never,
    planningDepthCap: params.planningDepthCap as never,
    createdAt: params.createdAt,
  };
  return {
    run,
    currentBlueprint: null,
    nodeMeta: new Map(),
    openDecisions: new Set(),
    autoDecisionLog: [],
    phaseApprovals: new Map(),
    childThreads: new Map(),
  };
}

// Main projector entry. Accepts `null` for the pre-creation state (so
// `weave.created` can materialize the projection). All other events require
// a non-null projection and return an error if passed null.
//
// Per-event logic is added incrementally in Tasks 2–5. Until then every
// branch falls through to the "no projection" error for null input and
// returns the projection unchanged for all event types.
export function projectWeaveEvent(
  state: WeaveRunProjection | null,
  event: WeaveOrchestrationEvent,
): Effect.Effect<WeaveRunProjection, OrchestrationProjectorDecodeError> {
  switch (event.type) {
    case "weave.created": {
      if (state !== null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave run '${state.run.id}' already exists — weave.created requires null state.`,
          }),
        );
      }
      const { payload } = event;
      return Effect.succeed(
        createEmptyWeaveProjection({
          id: payload.weaveRunId,
          projectId: payload.projectId,
          title: payload.title,
          vision: payload.vision,
          ...(payload.parentThreadId !== undefined && {
            parentThreadId: payload.parentThreadId,
          }),
          ...(payload.parentMessageId !== undefined && {
            parentMessageId: payload.parentMessageId,
          }),
          ...(payload.snapshotContent !== undefined && {
            snapshotContent: payload.snapshotContent,
          }),
          status: "draft",
          concurrencyCap: 1,
          planningDepthCap: 3,
          createdAt: payload.occurredAt,
        }),
      );
    }
    case "weave.blueprint-compiled": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.blueprint-compiled requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      // Preserve `nodeMeta` for nodes that survive into the new Blueprint.
      // New nodes (added by amendment/redesign/phase-planning) seed at "pending".
      // This preserves the planner node's "verified" status set by the preceding
      // `weave.node-verified` event in a `weave.blueprint.extend` batch (Slice 3
      // emitted node-verified + extended + compiled together).
      const nextNodeMeta = new Map<WeaveNodeId, WeaveNodeMeta>();
      for (const node of payload.blueprint.nodes) {
        const existing = state.nodeMeta.get(node.id);
        nextNodeMeta.set(node.id, existing ?? { status: "pending" });
      }
      const nextOpenDecisions = new Set<WeaveDecisionId>();
      for (const decision of payload.blueprint.decisions) {
        if (decision.resolution === undefined) {
          nextOpenDecisions.add(decision.id);
        }
      }
      return Effect.succeed({
        ...state,
        run: { ...state.run, status: "reviewing" },
        currentBlueprint: payload.blueprint,
        nodeMeta: nextNodeMeta,
        openDecisions: nextOpenDecisions,
      });
    }
    case "weave.blueprint-approved": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.blueprint-approved requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      return Effect.succeed({
        ...state,
        run: {
          ...state.run,
          status: "running",
          currentBlueprintVersion: payload.version,
          concurrencyCap: payload.concurrencyCap,
        },
      });
    }
    case "weave.node-dispatched": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.node-dispatched requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextNodeMeta = new Map(state.nodeMeta);
      const prevDispatchedMeta = nextNodeMeta.get(payload.nodeId);
      nextNodeMeta.set(payload.nodeId, {
        ...prevDispatchedMeta,
        status: "running",
        dispatchedAt: payload.occurredAt,
      });
      const nextChildThreads = new Map(state.childThreads);
      nextChildThreads.set(payload.nodeId, {
        threadId: payload.childThreadId,
        worktreePath: payload.worktreePath,
      });
      return Effect.succeed({
        ...state,
        nodeMeta: nextNodeMeta,
        childThreads: nextChildThreads,
      });
    }
    case "weave.node-verified": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.node-verified requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextNodeMeta = new Map(state.nodeMeta);
      const prevVerifiedMeta = nextNodeMeta.get(payload.nodeId);
      nextNodeMeta.set(payload.nodeId, {
        ...prevVerifiedMeta,
        status: "verified",
        verifiedAt: payload.occurredAt,
      });
      return Effect.succeed({ ...state, nodeMeta: nextNodeMeta });
    }
    case "weave.node-failed": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.node-failed requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextNodeMeta = new Map(state.nodeMeta);
      const prevFailedMeta = nextNodeMeta.get(payload.nodeId);
      nextNodeMeta.set(payload.nodeId, {
        ...prevFailedMeta,
        status: "failed",
        failedAt: payload.occurredAt,
        failureReason: payload.reason,
        ...(payload.failureOutput !== undefined ? { failureOutput: payload.failureOutput } : {}),
      });
      return Effect.succeed({ ...state, nodeMeta: nextNodeMeta });
    }
    case "weave.decision-resolved": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.decision-resolved requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextOpenDecisions = new Set(state.openDecisions);
      nextOpenDecisions.delete(payload.decisionId);
      const nextAutoDecisionLog = payload.byUser
        ? state.autoDecisionLog
        : [
            ...state.autoDecisionLog,
            { decisionId: payload.decisionId, answer: payload.answer, at: payload.occurredAt },
          ];
      return Effect.succeed({
        ...state,
        openDecisions: nextOpenDecisions,
        autoDecisionLog: nextAutoDecisionLog,
      });
    }
    case "weave.phase-approved": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.phase-approved requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextPhaseApprovals = new Map(state.phaseApprovals);
      nextPhaseApprovals.set(payload.phaseId, payload.approval);
      return Effect.succeed({ ...state, phaseApprovals: nextPhaseApprovals });
    }
    case "weave.exited": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.exited requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      return Effect.succeed({
        ...state,
        run: { ...state.run, status: payload.reason },
      });
    }
    case "weave.planner.thread-created": {
      // The planner thread is materialized in the projection_threads table by the
      // threads projector. The WeaveRun projection itself does not change here.
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.planner.thread-created requires existing projection (null received).`,
          }),
        );
      }
      return Effect.succeed(state);
    }
    case "weave.node-retry-requested": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.node-retry-requested requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextNodeMeta = new Map(state.nodeMeta);
      const prevMeta = nextNodeMeta.get(payload.nodeId);
      // Reset failure fields and flip status back to "running" so the conformer
      // (which subscribes to this event) re-runs the verifier in the existing
      // worktree. Keep dispatchedAt so the elapsed clock keeps showing total
      // time including retries.
      const {
        failureReason: _droppedReason,
        failureOutput: _droppedOutput,
        failedAt: _droppedFailedAt,
        verifiedAt: _droppedVerifiedAt,
        ...rest
      } = prevMeta ?? { status: "pending" as const };
      nextNodeMeta.set(payload.nodeId, {
        ...rest,
        status: "running",
      });
      return Effect.succeed({ ...state, nodeMeta: nextNodeMeta });
    }
    case "weave.node-restart-requested": {
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.node-restart-requested requires existing projection (null received).`,
          }),
        );
      }
      const { payload } = event;
      const nextNodeMeta = new Map(state.nodeMeta);
      const prevMeta = nextNodeMeta.get(payload.nodeId);
      // Reset failure fields and flip back to "running" so the restarter
      // reactor re-dispatches the agent on the existing child thread.
      const {
        failureReason: _droppedReason,
        failureOutput: _droppedOutput,
        failedAt: _droppedFailedAt,
        verifiedAt: _droppedVerifiedAt,
        ...rest
      } = prevMeta ?? { status: "pending" as const };
      nextNodeMeta.set(payload.nodeId, {
        ...rest,
        status: "running",
      });
      return Effect.succeed({ ...state, nodeMeta: nextNodeMeta });
    }
    case "weave.blueprint-extended": {
      // Informational: the sister `weave.blueprint-compiled` event carries the
      // full new Blueprint and is what mutates projection state (see
      // weaveDecider.ts: `weave.blueprint.extend` emits both events together).
      // We keep this arm for the audit/UI hook surface; future slices can wire
      // event-stream consumers off of it without touching projection state.
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave.blueprint-extended requires existing projection (null received).`,
          }),
        );
      }
      return Effect.succeed(state);
    }
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      // unreachable: all weave event types are explicitly handled above.
      // The never type assignment ensures TypeScript enforces exhaustiveness.
      return Effect.succeed(state as never);
    }
  }
}
