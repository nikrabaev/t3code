import {
  CommandId,
  EventId,
  OrchestrationEvent,
  ProjectId,
  ThreadId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { aggregateRefOf } from "./weaveAggregateRef.ts";

// Shared envelope fields for every event fixture.
const baseEnvelope = {
  sequence: 1,
  commandId: CommandId.make("cmd-1"),
  causationEventId: null,
  correlationId: CommandId.make("cmd-1"),
  metadata: {},
  occurredAt: new Date().toISOString(),
} as const;

describe("aggregateRefOf", () => {
  it("narrows a project.created event to a project AggregateRef", () => {
    const event = Schema.decodeSync(OrchestrationEvent)({
      ...baseEnvelope,
      eventId: EventId.make("evt-1"),
      aggregateKind: "project",
      aggregateId: ProjectId.make("project-1"),
      type: "project.created",
      payload: {
        projectId: ProjectId.make("project-1"),
        title: "My project",
        workspaceRoot: "/tmp/ws",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: baseEnvelope.occurredAt,
        updatedAt: baseEnvelope.occurredAt,
      },
    });

    const ref = aggregateRefOf(event);
    expect(ref.aggregateKind).toBe("project");
    expect(ref.aggregateId).toBe(ProjectId.make("project-1"));
  });

  it("narrows a thread.created event to a thread AggregateRef", () => {
    const event = Schema.decodeSync(OrchestrationEvent)({
      ...baseEnvelope,
      eventId: EventId.make("evt-2"),
      aggregateKind: "thread",
      aggregateId: ThreadId.make("thread-1"),
      type: "thread.created",
      payload: {
        threadId: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "My thread",
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: baseEnvelope.occurredAt,
        updatedAt: baseEnvelope.occurredAt,
      },
    });

    const ref = aggregateRefOf(event);
    expect(ref.aggregateKind).toBe("thread");
    expect(ref.aggregateId).toBe(ThreadId.make("thread-1"));
  });

  it("narrows a weave.created event to a weave AggregateRef", () => {
    const event = Schema.decodeSync(OrchestrationEvent)({
      ...baseEnvelope,
      eventId: EventId.make("evt-3"),
      aggregateKind: "weave",
      aggregateId: WeaveRunId.make("run-1"),
      type: "weave.created",
      payload: {
        weaveRunId: WeaveRunId.make("run-1"),
        projectId: ProjectId.make("project-1"),
        title: "Add blog",
        vision: "# Goal",
        occurredAt: baseEnvelope.occurredAt,
      },
    });

    const ref = aggregateRefOf(event);
    expect(ref.aggregateKind).toBe("weave");
    expect(ref.aggregateId).toBe(WeaveRunId.make("run-1"));
  });
});
