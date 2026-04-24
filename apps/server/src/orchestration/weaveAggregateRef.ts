import type {
  AggregateRef,
  OrchestrationEvent,
  ProjectId,
  ThreadId,
  WeaveRunId,
} from "@t3tools/contracts";

// aggregateRefOf narrows an OrchestrationEvent's (aggregateKind, aggregateId)
// plain-union pair into a discriminated AggregateRef. This is the single place
// the narrowing cast lives; call sites that were using `as ProjectId | ThreadId`
// should use `aggregateRefOf(event).aggregateId` instead.
export function aggregateRefOf(event: OrchestrationEvent): AggregateRef {
  switch (event.aggregateKind) {
    case "project":
      return { aggregateKind: "project", aggregateId: event.aggregateId as ProjectId };
    case "thread":
      return { aggregateKind: "thread", aggregateId: event.aggregateId as ThreadId };
    case "weave":
      return { aggregateKind: "weave", aggregateId: event.aggregateId as WeaveRunId };
  }
}
