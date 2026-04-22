import { CommandId, EventId, ProjectId, WeaveRunId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { projectWeaveEvent, type WeaveOrchestrationEvent } from "./weaveProjector.ts";

const now = new Date().toISOString();

// Helper: build a minimally-valid weave-aggregate event envelope.
function weaveEvent<T extends WeaveOrchestrationEvent["type"]>(
  type: T,
  payload: Extract<WeaveOrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<WeaveOrchestrationEvent> = {},
): Extract<WeaveOrchestrationEvent, { type: T }> {
  return {
    sequence: 1,
    eventId: EventId.make("event-" + type),
    aggregateKind: "weave",
    aggregateId: WeaveRunId.make("run-1"),
    type,
    occurredAt: now,
    commandId: CommandId.make("cmd-" + type),
    causationEventId: null,
    correlationId: CommandId.make("cmd-" + type),
    metadata: {},
    payload,
    ...overrides,
  } as Extract<WeaveOrchestrationEvent, { type: T }>;
}

describe("projectWeaveEvent — weave.created", () => {
  it("materializes a new projection with status=draft and concurrencyCap=1", async () => {
    const event = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "Test Run",
      vision: "# Goal",
      occurredAt: now,
    });

    const result = await Effect.runPromise(projectWeaveEvent(null, event));

    expect(result.run.id).toBe(WeaveRunId.make("run-1"));
    expect(result.run.title).toBe("Test Run");
    expect(result.run.status).toBe("draft");
    expect(result.run.concurrencyCap).toBe(1);
    expect(result.currentBlueprint).toBeNull();
    expect(result.nodeStatuses.size).toBe(0);
    expect(result.openDecisions.size).toBe(0);
    expect(result.autoDecisionLog.length).toBe(0);
    expect(result.phaseApprovals.size).toBe(0);
    expect(result.childThreads.size).toBe(0);
  });

  it("propagates optional parent-thread / parent-message / snapshot-content fields", async () => {
    const event = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-2"),
      projectId: ProjectId.make("project-1"),
      title: "With Parent",
      vision: "",
      parentThreadId: undefined, // optional
      occurredAt: now,
    });
    // Re-create with fields populated explicitly to test they flow through:
    const populated = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-3"),
      projectId: ProjectId.make("project-1"),
      title: "Full",
      vision: "",
      parentThreadId: "thread-parent" as never,
      parentMessageId: "msg-parent" as never,
      snapshotContent: "# parent chat",
      occurredAt: now,
    });

    const result = await Effect.runPromise(projectWeaveEvent(null, populated));
    expect(result.run.parentThreadId).toBe("thread-parent");
    expect(result.run.parentMessageId).toBe("msg-parent");
    expect(result.run.snapshotContent).toBe("# parent chat");
  });

  it("rejects when projection is non-null (run already exists)", async () => {
    const event = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "dup",
      vision: "",
      occurredAt: now,
    });
    const existing = await Effect.runPromise(projectWeaveEvent(null, event));
    await expect(Effect.runPromise(projectWeaveEvent(existing, event))).rejects.toThrow(
      "already exists",
    );
  });
});
