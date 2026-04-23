import type { OrchestrationEvent, WeaveCommand, WeaveRunId } from "@t3tools/contracts";
import { EventId } from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { requireRunAbsent } from "./weaveCommandInvariants.ts";
import type { WeaveRunProjection } from "./weaveProjector.ts";

// PlannedWeaveEvent: a weave-aggregate OrchestrationEvent minus `sequence`
// (the engine assigns sequence at persistence time). All other envelope fields
// are produced by the decider.
//
// Using a distributive Omit so the discriminated union is preserved:
// `Omit<A | B, K>` would collapse the union; `DistributiveOmit` applies
// Omit to each member individually, keeping the discriminant intact.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type PlannedWeaveEvent = DistributiveOmit<
  Extract<OrchestrationEvent, { readonly type: `weave.${string}` }>,
  "sequence"
>;

type WeaveEventType = PlannedWeaveEvent["type"];

function envelope<T extends WeaveEventType>(input: {
  readonly type: T;
  readonly weaveRunId: WeaveRunId;
  readonly occurredAt: string;
  readonly commandId: WeaveCommand["commandId"];
  readonly payload: unknown;
}): Extract<PlannedWeaveEvent, { type: T }> {
  const base = {
    eventId: EventId.make(crypto.randomUUID()),
    aggregateKind: "weave" as const,
    aggregateId: input.weaveRunId,
    type: input.type,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: {},
    payload: input.payload,
  };
  return base as unknown as Extract<PlannedWeaveEvent, { type: T }>;
}

export function decideWeaveCommand(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<ReadonlyArray<PlannedWeaveEvent>, OrchestrationCommandInvariantError> {
  const { projection, command } = input;

  switch (command.type) {
    case "weave.create": {
      return Effect.gen(function* () {
        yield* requireRunAbsent({ projection, command });
        return [
          envelope({
            type: "weave.created",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              projectId: command.projectId,
              title: command.title,
              vision: command.vision,
              ...(command.parentThreadId !== undefined && {
                parentThreadId: command.parentThreadId,
              }),
              ...(command.parentMessageId !== undefined && {
                parentMessageId: command.parentMessageId,
              }),
              ...(command.snapshotContent !== undefined && {
                snapshotContent: command.snapshotContent,
              }),
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    // Placeholder for Tasks 7–9.
    default: {
      return Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Decider does not yet handle '${command.type}' (pending Slice 2 tasks).`,
        }),
      );
    }
  }
}
