import {
  Blueprint,
  type BlueprintSource,
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
import { Effect, Schema } from "effect";
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

/**
 * Build a minimal Blueprint for projector tests.
 *
 * Defaults:
 *  - `version`: required (callers always specify it).
 *  - `compiledBy`: "planner" if not provided.
 *  - Each node: `description` "", empty `scope`/contracts, empty
 *    `verifierDescription`, status "pending".
 *  - One phase ("p1", ordinal 0) if `phases` is omitted.
 *
 * Decode is via `Schema.decodeSync(Blueprint)` so the result is the same
 * branded-typed shape the production code returns.
 */
type NodeOpts = {
  id: string;
  kind?: "raw" | "scaffold" | "contract" | "utility" | "planning";
  phaseId?: string;
  dependsOn?: ReadonlyArray<string>;
  title?: string;
};
type PhaseOpts = { id: string; ordinal: number; title?: string };

function makeMinimalBlueprint(opts: {
  version: number;
  nodes: ReadonlyArray<NodeOpts>;
  phases?: ReadonlyArray<PhaseOpts>;
  compiledBy?: BlueprintSource;
}): Blueprint {
  const phases = opts.phases ?? [{ id: "p1", ordinal: 0 }];
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(opts.version),
    nodes: opts.nodes.map((n) => ({
      id: WeaveNodeId.make(n.id),
      title: n.title ?? n.id,
      description: "",
      kind: n.kind ?? "raw",
      phaseId: WeavePhaseId.make(n.phaseId ?? phases[0]!.id),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: (n.dependsOn ?? []).map((d) => WeaveNodeId.make(d)),
      status: "pending",
    })),
    phases: phases.map((p) => ({
      id: WeavePhaseId.make(p.id),
      ordinal: p.ordinal,
      title: p.title ?? p.id,
      description: "",
      approval: "pending",
    })),
    contracts: [],
    decisions: [],
    compiledAt: now,
    compiledBy: opts.compiledBy ?? "planner",
  });
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
    expect(result.run.planningDepthCap).toBe(3);
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

describe("projectWeaveEvent — weave.blueprint-extended", () => {
  it("rejects when state is null", async () => {
    const event = weaveEvent("weave.blueprint-extended", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(2),
      plannerNodeId: WeaveNodeId.make("phase-1-planner"),
      addedNodeIds: [],
      occurredAt: now,
    });
    const result = await Effect.runPromiseExit(projectWeaveEvent(null, event));
    expect(result._tag).toBe("Failure");
  });

  it("returns state unchanged on non-null state", async () => {
    // Build a non-null projection by running weave.created first.
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "Test Run",
      vision: "",
      occurredAt: now,
    });
    const afterCreated = await Effect.runPromise(projectWeaveEvent(null, created));

    const extended = weaveEvent("weave.blueprint-extended", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(2),
      plannerNodeId: WeaveNodeId.make("phase-1-planner"),
      addedNodeIds: [WeaveNodeId.make("task-1")],
      occurredAt: now,
    });
    const after = await Effect.runPromise(projectWeaveEvent(afterCreated, extended));
    // Same projection — `weave.blueprint-extended` is informational; the
    // sister `weave.blueprint-compiled` does the real mutation.
    expect(after).toBe(afterCreated);
  });
});

describe("projectWeaveEvent — weave.blueprint-compiled (nodeMeta preservation)", () => {
  it("preserves prior verified status when a node survives into a new Blueprint version", async () => {
    // Build a starting projection with a node already verified.
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      projectId: ProjectId.make("project-1"),
      title: "Test",
      vision: "",
      occurredAt: now,
    });
    const v1 = makeMinimalBlueprint({
      version: 1,
      nodes: [{ id: "n1", kind: "planning" }],
    });
    const compileV1 = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      version: BlueprintVersion.make(1),
      blueprint: v1,
      compiledBy: "planner",
      occurredAt: now,
    });
    const verified = weaveEvent("weave.node-verified", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      nodeId: WeaveNodeId.make("n1"),
      verifierOutcome: "ok",
      occurredAt: now,
    });

    // Apply created → blueprint-compiled v1 → node-verified for n1.
    const afterCreated = await Effect.runPromise(projectWeaveEvent(null, created));
    const afterV1 = await Effect.runPromise(projectWeaveEvent(afterCreated, compileV1));
    const afterVerified = await Effect.runPromise(projectWeaveEvent(afterV1, verified));
    expect(afterVerified.nodeMeta.get(WeaveNodeId.make("n1"))?.status).toBe("verified");

    // Now apply blueprint-compiled v2 with phase-planning reason (n1 still
    // present, plus a fresh task n2 added).
    const v2 = makeMinimalBlueprint({
      version: 2,
      compiledBy: "phase-planning",
      nodes: [
        { id: "n1", kind: "planning" },
        { id: "n2", kind: "raw", dependsOn: ["n1"] },
      ],
    });
    const compileV2 = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      version: BlueprintVersion.make(2),
      blueprint: v2,
      compiledBy: "phase-planning",
      occurredAt: now,
    });

    const afterV2 = await Effect.runPromise(projectWeaveEvent(afterVerified, compileV2));

    // n1's verified status survives; n2 starts at pending.
    expect(afterV2.nodeMeta.get(WeaveNodeId.make("n1"))?.status).toBe("verified");
    expect(afterV2.nodeMeta.get(WeaveNodeId.make("n2"))?.status).toBe("pending");
  });

  it("seeds 'pending' for every node on the very first compile (state.nodeMeta empty)", async () => {
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-preserve-2"),
      projectId: ProjectId.make("project-1"),
      title: "Test",
      vision: "",
      occurredAt: now,
    });
    const v1 = makeMinimalBlueprint({
      version: 1,
      nodes: [
        { id: "a", kind: "raw" },
        { id: "b", kind: "raw" },
      ],
    });
    const compileV1 = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-preserve-2"),
      version: BlueprintVersion.make(1),
      blueprint: v1,
      compiledBy: "planner",
      occurredAt: now,
    });
    const afterCreated = await Effect.runPromise(projectWeaveEvent(null, created));
    const afterV1 = await Effect.runPromise(projectWeaveEvent(afterCreated, compileV1));
    expect(afterV1.nodeMeta.get(WeaveNodeId.make("a"))?.status).toBe("pending");
    expect(afterV1.nodeMeta.get(WeaveNodeId.make("b"))?.status).toBe("pending");
  });
});

describe("projectWeaveEvent — weave.deleted", () => {
  it("returns state unchanged when state is non-null (deletion is handled at the read-model level)", async () => {
    const created = await Effect.runPromise(
      projectWeaveEvent(
        null,
        weaveEvent("weave.created", {
          weaveRunId: WeaveRunId.make("run-1"),
          projectId: ProjectId.make("project-1"),
          title: "x",
          vision: "",
          occurredAt: now,
        }),
      ),
    );
    const after = await Effect.runPromise(
      projectWeaveEvent(
        created,
        weaveEvent("weave.deleted", {
          weaveRunId: WeaveRunId.make("run-1"),
          occurredAt: now,
        }),
      ),
    );
    expect(after).toBe(created);
  });

  it("fails when called with null state (unreachable in production)", async () => {
    const result = await Effect.runPromiseExit(
      projectWeaveEvent(
        null,
        weaveEvent("weave.deleted", {
          weaveRunId: WeaveRunId.make("run-1"),
          occurredAt: now,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
  });
});
