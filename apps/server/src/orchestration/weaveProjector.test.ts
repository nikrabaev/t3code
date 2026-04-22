import {
  BlueprintVersion,
  CommandId,
  EventId,
  ProjectId,
  WeaveDecisionId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
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

describe("projectWeaveEvent — weave.blueprint-compiled", () => {
  it("sets currentBlueprint, transitions to reviewing, hydrates nodeStatuses and openDecisions", async () => {
    const createdEvent = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const initial = await Effect.runPromise(projectWeaveEvent(null, createdEvent));

    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [
          {
            id: WeaveNodeId.make("node-1"),
            title: "First",
            description: "",
            kind: "scaffold",
            phaseId: WeavePhaseId.make("phase-1"),
            scope: { readSet: [], writeSet: [] },
            inputContractIds: [],
            outputContractIds: [],
            verifierDescription: "",
            dependsOn: [],
            status: "pending",
          },
          {
            id: WeaveNodeId.make("node-2"),
            title: "Second",
            description: "",
            kind: "raw",
            phaseId: WeavePhaseId.make("phase-1"),
            scope: { readSet: [], writeSet: [] },
            inputContractIds: [],
            outputContractIds: [],
            verifierDescription: "",
            dependsOn: [WeaveNodeId.make("node-1")],
            status: "pending",
          },
        ],
        phases: [
          {
            id: WeavePhaseId.make("phase-1"),
            ordinal: 0,
            title: "Foundations",
            description: "",
            approval: "pending",
          },
        ],
        contracts: [],
        decisions: [
          {
            id: WeaveDecisionId.make("decision-1"),
            question: "Pick a state library.",
            options: ["jotai", "zustand"],
            blastRadiusNodeIds: [],
          },
        ],
        compiledAt: now,
        compiledBy: "planner",
      },
    });

    const result = await Effect.runPromise(projectWeaveEvent(initial, compiled));

    expect(result.run.status).toBe("reviewing");
    expect(result.currentBlueprint?.version).toBe(BlueprintVersion.make(1));
    expect(result.nodeStatuses.get(WeaveNodeId.make("node-1"))).toBe("pending");
    expect(result.nodeStatuses.get(WeaveNodeId.make("node-2"))).toBe("pending");
    expect(result.openDecisions.has(WeaveDecisionId.make("decision-1"))).toBe(true);
  });

  it("excludes already-resolved decisions from openDecisions", async () => {
    const createdEvent = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-2"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const initial = await Effect.runPromise(projectWeaveEvent(null, createdEvent));

    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-2"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [
          {
            id: WeaveDecisionId.make("decision-resolved"),
            question: "Q",
            options: ["a"],
            blastRadiusNodeIds: [],
            resolution: {
              answer: "a",
              byUser: true,
              resolvedAt: now,
            },
          },
          {
            id: WeaveDecisionId.make("decision-open"),
            question: "Q",
            options: ["a"],
            blastRadiusNodeIds: [],
          },
        ],
        compiledAt: now,
        compiledBy: "planner",
      },
    });

    const result = await Effect.runPromise(projectWeaveEvent(initial, compiled));
    expect(result.openDecisions.has(WeaveDecisionId.make("decision-open"))).toBe(true);
    expect(result.openDecisions.has(WeaveDecisionId.make("decision-resolved"))).toBe(false);
  });
});

describe("projectWeaveEvent — weave.blueprint-approved", () => {
  it("sets currentBlueprintVersion, transitions to running, applies concurrencyCap", async () => {
    const createdEvent = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const created = await Effect.runPromise(projectWeaveEvent(null, createdEvent));
    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner",
      },
    });
    const reviewing = await Effect.runPromise(projectWeaveEvent(created, compiled));

    const approved = weaveEvent("weave.blueprint-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      concurrencyCap: 1,
      occurredAt: now,
    });

    const result = await Effect.runPromise(projectWeaveEvent(reviewing, approved));
    expect(result.run.status).toBe("running");
    expect(result.run.currentBlueprintVersion).toBe(BlueprintVersion.make(1));
    expect(result.run.concurrencyCap).toBe(1);
  });
});
