import type {
  Blueprint,
  IsoDateTime,
  MessageId,
  OrchestrationEvent,
  ProjectId,
  ThreadId,
  WeaveDecisionId,
  WeaveNodeId,
  WeaveNodeStatus,
  WeavePhaseApproval,
  WeavePhaseId,
  WeaveRun,
  WeaveRunId,
  WeaveRunStatus,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationProjectorDecodeError } from "./Errors.ts";

// A WeaveRunProjection is the state accumulated for one Weave Run by replaying
// that run's events. It is server-internal (not part of OrchestrationReadModel).
// Slice 3 will own a container store keyed by WeaveRunId.
export type WeaveRunProjection = {
  readonly run: WeaveRun;
  readonly currentBlueprint: Blueprint | null;
  readonly nodeStatuses: ReadonlyMap<WeaveNodeId, WeaveNodeStatus>;
  readonly openDecisions: ReadonlySet<WeaveDecisionId>;
  readonly autoDecisionLog: ReadonlyArray<{
    readonly decisionId: WeaveDecisionId;
    readonly answer: string;
    readonly at: IsoDateTime;
  }>;
  readonly phaseApprovals: ReadonlyMap<WeavePhaseId, WeavePhaseApproval>;
  readonly childThreads: ReadonlyMap<
    WeaveNodeId,
    {
      readonly threadId: ThreadId;
      readonly worktreePath: string;
    }
  >;
};

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
    createdAt: params.createdAt,
  };
  return {
    run,
    currentBlueprint: null,
    nodeStatuses: new Map(),
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
      const nextNodeStatuses = new Map<WeaveNodeId, WeaveNodeStatus>();
      for (const node of payload.blueprint.nodes) {
        nextNodeStatuses.set(node.id, "pending");
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
        nodeStatuses: nextNodeStatuses,
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
      const nextNodeStatuses = new Map(state.nodeStatuses);
      nextNodeStatuses.set(payload.nodeId, "running");
      const nextChildThreads = new Map(state.childThreads);
      nextChildThreads.set(payload.nodeId, {
        threadId: payload.childThreadId,
        worktreePath: payload.worktreePath,
      });
      return Effect.succeed({
        ...state,
        nodeStatuses: nextNodeStatuses,
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
      const nextNodeStatuses = new Map(state.nodeStatuses);
      nextNodeStatuses.set(payload.nodeId, "verified");
      return Effect.succeed({ ...state, nodeStatuses: nextNodeStatuses });
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
      const nextNodeStatuses = new Map(state.nodeStatuses);
      nextNodeStatuses.set(payload.nodeId, "failed");
      return Effect.succeed({ ...state, nodeStatuses: nextNodeStatuses });
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
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      // unreachable: all weave event types are explicitly handled above.
      // The never type assignment ensures TypeScript enforces exhaustiveness.
      return Effect.succeed(state as never);
    }
  }
}
