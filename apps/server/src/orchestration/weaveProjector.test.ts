import {
  BlueprintVersion,
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  WeaveDecisionId,
  WeaveNodeId,
  type WeaveNodeMeta,
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
    expect(result.nodeMeta.size).toBe(0);
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
  it("sets currentBlueprint, transitions to reviewing, hydrates nodeMeta and openDecisions", async () => {
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
    expect(result.nodeMeta.get(WeaveNodeId.make("node-1"))?.status).toBe("pending");
    expect(result.nodeMeta.get(WeaveNodeId.make("node-2"))?.status).toBe("pending");
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

describe("projectWeaveEvent — node lifecycle", () => {
  async function runningProjectionWithNode(nodeId: WeaveNodeId) {
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const p0 = await Effect.runPromise(projectWeaveEvent(null, created));
    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [
          {
            id: nodeId,
            title: "Only",
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
        ],
        phases: [
          {
            id: WeavePhaseId.make("phase-1"),
            ordinal: 0,
            title: "Phase 1",
            description: "",
            approval: "pending",
          },
        ],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner",
      },
    });
    const p1 = await Effect.runPromise(projectWeaveEvent(p0, compiled));
    const approved = weaveEvent("weave.blueprint-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      concurrencyCap: 1,
      occurredAt: now,
    });
    return await Effect.runPromise(projectWeaveEvent(p1, approved));
  }

  it("weave.node-dispatched flips nodeStatus to running and records childThreads entry", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatched = weaveEvent("weave.node-dispatched", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      childThreadId: ThreadId.make("thread-1"),
      worktreePath: "/tmp/wt/node-1",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    expect(result.nodeMeta.get(nodeId)?.status).toBe("running");
    expect(result.nodeMeta.get(nodeId)?.dispatchedAt).toBe(now);
    expect(result.childThreads.get(nodeId)?.threadId).toBe(ThreadId.make("thread-1"));
    expect(result.childThreads.get(nodeId)?.worktreePath).toBe("/tmp/wt/node-1");
  });

  it("weave.node-verified flips nodeStatus to verified", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatched = weaveEvent("weave.node-dispatched", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      childThreadId: ThreadId.make("thread-1"),
      worktreePath: "/tmp/wt/node-1",
      occurredAt: now,
    });
    const running = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    const verified = weaveEvent("weave.node-verified", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      verifierOutcome: "tests-passed",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(running, verified));
    expect(result.nodeMeta.get(nodeId)?.status).toBe("verified");
    expect(result.nodeMeta.get(nodeId)?.verifiedAt).toBe(now);
    // dispatchedAt should be preserved from the dispatched event
    expect(result.nodeMeta.get(nodeId)?.dispatchedAt).toBe(now);
  });

  it("weave.node-failed flips nodeStatus to failed", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatched = weaveEvent("weave.node-dispatched", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      childThreadId: ThreadId.make("thread-1"),
      worktreePath: "/tmp/wt/node-1",
      occurredAt: now,
    });
    const running = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    const failed = weaveEvent("weave.node-failed", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      reason: "Verifier exit 1",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(running, failed));
    expect(result.nodeMeta.get(nodeId)?.status).toBe("failed");
    expect(result.nodeMeta.get(nodeId)?.failedAt).toBe(now);
    expect(result.nodeMeta.get(nodeId)?.failureReason).toBe("Verifier exit 1");
    // dispatchedAt should be preserved from the dispatched event
    expect(result.nodeMeta.get(nodeId)?.dispatchedAt).toBe(now);
  });

  it("weave.node-failed populates failureReason and failedAt (positive test)", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatchedAt = "2026-04-25T10:00:00.000Z";
    const failedAt = "2026-04-25T10:05:00.000Z";
    const dispatched = weaveEvent(
      "weave.node-dispatched",
      {
        weaveRunId: WeaveRunId.make("run-1"),
        nodeId,
        childThreadId: ThreadId.make("thread-1"),
        worktreePath: "/tmp/wt/node-1",
        occurredAt: dispatchedAt,
      },
      { occurredAt: dispatchedAt },
    );
    const running = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    const failReason = "Process exited with code 2: assertion failed in test suite";
    const failed = weaveEvent(
      "weave.node-failed",
      {
        weaveRunId: WeaveRunId.make("run-1"),
        nodeId,
        reason: failReason,
        occurredAt: failedAt,
      },
      { occurredAt: failedAt },
    );
    const result = await Effect.runPromise(projectWeaveEvent(running, failed));
    const meta: WeaveNodeMeta | undefined = result.nodeMeta.get(nodeId);
    expect(meta?.status).toBe("failed");
    expect(meta?.failedAt).toBe(failedAt);
    expect(meta?.failureReason).toBe(failReason);
    // dispatchedAt is preserved across the failed transition
    expect(meta?.dispatchedAt).toBe(dispatchedAt);
    // verifiedAt is absent
    expect(meta?.verifiedAt).toBeUndefined();
  });
});

describe("projectWeaveEvent — decision, phase, exit", () => {
  // Helper to reach a running projection (reuses runningProjectionWithNode from the prior describe block).
  // Since runningProjectionWithNode is declared inside that describe, we duplicate the minimal pieces here.

  async function runningProjection() {
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const p0 = await Effect.runPromise(projectWeaveEvent(null, created));
    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [],
        phases: [
          {
            id: WeavePhaseId.make("phase-1"),
            ordinal: 0,
            title: "Only Phase",
            description: "",
            approval: "pending",
          },
        ],
        contracts: [],
        decisions: [
          {
            id: WeaveDecisionId.make("decision-1"),
            question: "Q",
            options: ["a", "b"],
            blastRadiusNodeIds: [],
          },
        ],
        compiledAt: now,
        compiledBy: "planner",
      },
    });
    const p1 = await Effect.runPromise(projectWeaveEvent(p0, compiled));
    const approved = weaveEvent("weave.blueprint-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      concurrencyCap: 1,
      occurredAt: now,
    });
    return await Effect.runPromise(projectWeaveEvent(p1, approved));
  }

  it("weave.decision-resolved by user removes decision from openDecisions and leaves autoDecisionLog unchanged", async () => {
    const state = await runningProjection();
    const decisionId = WeaveDecisionId.make("decision-1");
    const resolved = weaveEvent("weave.decision-resolved", {
      weaveRunId: WeaveRunId.make("run-1"),
      decisionId,
      answer: "a",
      byUser: true,
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, resolved));
    expect(result.openDecisions.has(decisionId)).toBe(false);
    expect(result.autoDecisionLog.length).toBe(0);
  });

  it("weave.decision-resolved by AI (byUser=false) appends to autoDecisionLog", async () => {
    const state = await runningProjection();
    const decisionId = WeaveDecisionId.make("decision-1");
    const resolved = weaveEvent("weave.decision-resolved", {
      weaveRunId: WeaveRunId.make("run-1"),
      decisionId,
      answer: "b",
      byUser: false,
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, resolved));
    expect(result.openDecisions.has(decisionId)).toBe(false);
    expect(result.autoDecisionLog.length).toBe(1);
    const logEntry = result.autoDecisionLog[0];
    expect(logEntry?.decisionId).toBe(decisionId);
    expect(logEntry?.answer).toBe("b");
    expect(logEntry?.at).toBe(now);
  });

  it("weave.phase-approved with approval=approved sets phaseApprovals entry", async () => {
    const state = await runningProjection();
    const phaseId = WeavePhaseId.make("phase-1");
    const approved = weaveEvent("weave.phase-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      phaseId,
      approval: "approved",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, approved));
    expect(result.phaseApprovals.get(phaseId)).toBe("approved");
  });

  it("weave.phase-approved with approval=rejected sets phaseApprovals entry", async () => {
    const state = await runningProjection();
    const phaseId = WeavePhaseId.make("phase-1");
    const rejected = weaveEvent("weave.phase-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      phaseId,
      approval: "rejected",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, rejected));
    expect(result.phaseApprovals.get(phaseId)).toBe("rejected");
  });

  it("weave.exited with reason=complete sets run.status to complete", async () => {
    const state = await runningProjection();
    const exited = weaveEvent("weave.exited", {
      weaveRunId: WeaveRunId.make("run-1"),
      reason: "complete",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, exited));
    expect(result.run.status).toBe("complete");
  });

  it("weave.exited with reason=aborted sets run.status to aborted", async () => {
    const state = await runningProjection();
    const exited = weaveEvent("weave.exited", {
      weaveRunId: WeaveRunId.make("run-1"),
      reason: "aborted",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, exited));
    expect(result.run.status).toBe("aborted");
  });
});
