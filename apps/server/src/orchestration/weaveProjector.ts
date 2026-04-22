import type {
  Blueprint,
  IsoDateTime,
  OrchestrationEvent,
  ThreadId,
  WeaveDecisionId,
  WeaveNodeId,
  WeaveNodeStatus,
  WeavePhaseApproval,
  WeavePhaseId,
  WeaveRun,
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
export function createEmptyWeaveProjection(run: WeaveRun): WeaveRunProjection {
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
  // Populated in Tasks 2–5. For now, every event type is a no-op modulo null.
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave event ${event.type} requires a pre-existing projection (null received)`,
      }),
    );
  }
  return Effect.succeed(state);
}
