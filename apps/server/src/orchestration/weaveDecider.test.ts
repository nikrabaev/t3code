import {
  BlueprintVersion,
  CommandId,
  ProjectId,
  ThreadId,
  WeaveDecisionId,
  WeaveNodeId,
  type WeaveNodeMeta,
  WeaveNodeStatus,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideWeaveCommand } from "./weaveDecider.ts";
import { createEmptyWeaveProjection, type WeaveRunProjection } from "./weaveProjector.ts";

const now = new Date().toISOString();

const emptyProjection = (runId = "run-1"): WeaveRunProjection =>
  createEmptyWeaveProjection({
    id: WeaveRunId.make(runId),
    projectId: ProjectId.make("project-1"),
    title: "X",
    vision: "",
    status: "draft",
    concurrencyCap: 1,
    createdAt: now,
  });

// Build a projection in "running" state with a single-phase blueprint.
// Each entry in `nodes` may override phaseId, dependsOn, and status.
function buildRunningProjection(params: {
  runId?: string;
  nodes: Array<{
    id: string;
    phaseId?: string;
    dependsOn?: string[];
    status?: WeaveNodeStatus;
  }>;
  phases: Array<{ id: string; ordinal: number }>;
}): WeaveRunProjection {
  const runId = params.runId ?? "run-1";
  const defaultPhaseId = params.phases[0]?.id ?? "phase-1";
  const nodeMeta = new Map<WeaveNodeId, WeaveNodeMeta>();
  for (const n of params.nodes) {
    nodeMeta.set(WeaveNodeId.make(n.id), { status: n.status ?? "pending" });
  }
  const base = createEmptyWeaveProjection({
    id: WeaveRunId.make(runId),
    projectId: ProjectId.make("project-1"),
    title: "X",
    vision: "",
    status: "running",
    concurrencyCap: 1,
    createdAt: now,
  });
  return {
    ...base,
    run: { ...base.run, status: "running" },
    currentBlueprint: {
      version: BlueprintVersion.make(1),
      nodes: params.nodes.map((n) => ({
        id: WeaveNodeId.make(n.id),
        title: n.id as unknown as ReturnType<typeof WeaveNodeId.make>,
        description: "",
        kind: "raw" as const,
        phaseId: WeavePhaseId.make(n.phaseId ?? defaultPhaseId),
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "",
        dependsOn: (n.dependsOn ?? []).map((id) => WeaveNodeId.make(id)),
        status: "pending" as const,
      })),
      phases: params.phases.map((p) => ({
        id: WeavePhaseId.make(p.id),
        ordinal: p.ordinal,
        title: p.id as unknown as ReturnType<typeof WeavePhaseId.make>,
        description: "",
        approval: "pending" as const,
      })),
      contracts: [],
      decisions: [],
      compiledAt: now,
      compiledBy: "planner" as const,
    },
    nodeMeta,
    openDecisions: new Set(),
    autoDecisionLog: [],
    phaseApprovals: new Map(),
    childThreads: new Map(),
  };
}

describe("decideWeaveCommand — weave.create", () => {
  it("emits weave.created when the run does not exist", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: null,
        command: {
          type: "weave.create",
          commandId: CommandId.make("cmd-1"),
          weaveRunId: WeaveRunId.make("run-1"),
          projectId: ProjectId.make("project-1"),
          title: "Test Run",
          vision: "# Goal",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.created");
    expect(events[0]?.aggregateKind).toBe("weave");
    expect(events[0]?.aggregateId).toBe(WeaveRunId.make("run-1"));
    const firstEvent = events[0];
    if (firstEvent !== undefined && firstEvent.type === "weave.created") {
      expect(firstEvent.payload.title).toBe("Test Run");
    }
  });

  it("rejects weave.create when run already exists", async () => {
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: emptyProjection(),
          command: {
            type: "weave.create",
            commandId: CommandId.make("cmd-2"),
            weaveRunId: WeaveRunId.make("run-1"),
            projectId: ProjectId.make("project-1"),
            title: "dup",
            vision: "",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("already exists");
  });
});

describe("decideWeaveCommand — weave.blueprint.compile", () => {
  it("returns [] when run is in draft with reason=initial (planner emits event directly)", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: emptyProjection(),
        command: {
          type: "weave.blueprint.compile",
          commandId: CommandId.make("cmd-c"),
          weaveRunId: WeaveRunId.make("run-1"),
          reason: "initial",
          createdAt: now,
        },
      }),
    );
    expect(events).toEqual([]);
  });

  it("rejects when run is complete", async () => {
    const base = emptyProjection();
    const p: WeaveRunProjection = {
      ...base,
      run: { ...base.run, status: "complete" },
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.blueprint.compile",
            commandId: CommandId.make("cmd-c"),
            weaveRunId: WeaveRunId.make("run-1"),
            reason: "amendment",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("decideWeaveCommand — weave.blueprint.approve", () => {
  const reviewingProjectionWithBlueprint = (version: number): WeaveRunProjection => {
    const base = emptyProjection();
    return {
      ...base,
      run: { ...base.run, status: "reviewing" },
      currentBlueprint: {
        version: BlueprintVersion.make(version),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner" as const,
      },
    };
  };

  it("emits weave.blueprint-approved when version matches and run is reviewing", async () => {
    const p = reviewingProjectionWithBlueprint(1);
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.blueprint.approve",
          commandId: CommandId.make("cmd-a"),
          weaveRunId: WeaveRunId.make("run-1"),
          blueprintVersion: BlueprintVersion.make(1),
          concurrencyCap: 1,
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.blueprint-approved");
  });

  it("rejects when version mismatches", async () => {
    const p = reviewingProjectionWithBlueprint(1);
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.blueprint.approve",
            commandId: CommandId.make("cmd-a"),
            weaveRunId: WeaveRunId.make("run-1"),
            blueprintVersion: BlueprintVersion.make(2),
            concurrencyCap: 1,
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("version mismatch");
  });

  it("rejects when run not in reviewing", async () => {
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: emptyProjection(), // status=draft
          command: {
            type: "weave.blueprint.approve",
            commandId: CommandId.make("cmd-a"),
            weaveRunId: WeaveRunId.make("run-1"),
            blueprintVersion: BlueprintVersion.make(1),
            concurrencyCap: 1,
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("decideWeaveCommand — weave.exit", () => {
  it("emits weave.exited with reason from command", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: emptyProjection(),
        command: {
          type: "weave.exit",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          reason: "aborted",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.exited");
    const first = events[0];
    if (first !== undefined && first.type === "weave.exited") {
      expect(first.payload.reason).toBe("aborted");
    }
  });

  it("rejects when run already complete", async () => {
    const base = emptyProjection();
    const p: WeaveRunProjection = {
      ...base,
      run: { ...base.run, status: "complete" },
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.exit",
            commandId: CommandId.make("cmd-x"),
            weaveRunId: WeaveRunId.make("run-1"),
            reason: "complete",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("already terminated");
  });
});

describe("decideWeaveCommand — weave.node.dispatch", () => {
  it("emits weave.node-dispatched when node is ready and has no ancestors", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "ready" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.dispatch",
          commandId: CommandId.make("cmd-d"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          childThreadId: ThreadId.make("thread-1"),
          worktreePath: "/tmp/wt",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-dispatched");
    const first = events[0];
    if (first !== undefined && first.type === "weave.node-dispatched") {
      expect(first.payload.nodeId).toBe(WeaveNodeId.make("node-1"));
      expect(first.payload.worktreePath).toBe("/tmp/wt");
    }
  });

  it("emits weave.node-dispatched when all ancestors are verified", async () => {
    const p = buildRunningProjection({
      nodes: [
        { id: "parent", status: "verified" },
        { id: "child", dependsOn: ["parent"], status: "ready" },
      ],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.dispatch",
          commandId: CommandId.make("cmd-d"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("child"),
          childThreadId: ThreadId.make("thread-2"),
          worktreePath: "/tmp/wt2",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-dispatched");
  });

  it("rejects dispatch when run is not running", async () => {
    const base = emptyProjection(); // status=draft
    const p: WeaveRunProjection = {
      ...base,
      nodeMeta: new Map([[WeaveNodeId.make("node-1"), { status: "ready" as const }]]),
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.dispatch",
            commandId: CommandId.make("cmd-d"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            childThreadId: ThreadId.make("thread-1"),
            worktreePath: "/tmp/wt",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  // v0.1 shortcut: scheduler dispatches nodes in "pending" status, skipping the
  // explicit pending→ready transition. The decider now accepts both "pending" and
  // "ready". See docs/superpowers/followups/2026-04-24-reintroduce-weave-node-ready-transition.md
  it("accepts dispatch when node is in pending status (v0.1 shortcut: pending→ready skipped)", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "pending" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.dispatch",
          commandId: CommandId.make("cmd-d"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          childThreadId: ThreadId.make("thread-1"),
          worktreePath: "/tmp/wt",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-dispatched");
  });

  it("rejects dispatch when node is in a non-dispatchable status (e.g. running)", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "running" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.dispatch",
            commandId: CommandId.make("cmd-d"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            childThreadId: ThreadId.make("thread-1"),
            worktreePath: "/tmp/wt",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("status is 'running'");
  });

  it("rejects dispatch when an ancestor is not verified", async () => {
    const p = buildRunningProjection({
      nodes: [
        { id: "parent", status: "running" }, // still running, not verified
        { id: "child", dependsOn: ["parent"], status: "ready" },
      ],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.dispatch",
            commandId: CommandId.make("cmd-d"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("child"),
            childThreadId: ThreadId.make("thread-1"),
            worktreePath: "/tmp/wt",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("ancestor");
  });
});

describe("decideWeaveCommand — weave.node.verified", () => {
  it("emits only weave.node-verified when phase has other pending nodes", async () => {
    const p = buildRunningProjection({
      nodes: [
        { id: "node-1", status: "running" },
        { id: "node-2", status: "pending" }, // still pending — phase not complete
      ],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.verified",
          commandId: CommandId.make("cmd-v"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          verifierOutcome: "All tests pass.",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-verified");
  });

  it("emits weave.node-verified + weave.phase-approved when this node completes the phase but there is another phase", async () => {
    const p = buildRunningProjection({
      nodes: [
        { id: "node-1", phaseId: "phase-1", status: "running" }, // only node in phase-1
        { id: "node-2", phaseId: "phase-2", status: "pending" },
      ],
      phases: [
        { id: "phase-1", ordinal: 0 },
        { id: "phase-2", ordinal: 1 },
      ],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.verified",
          commandId: CommandId.make("cmd-v"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          verifierOutcome: "Phase 1 done.",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("weave.node-verified");
    expect(events[1]?.type).toBe("weave.phase-approved");
    const phaseEvent = events[1];
    if (phaseEvent !== undefined && phaseEvent.type === "weave.phase-approved") {
      expect(phaseEvent.payload.phaseId).toBe(WeavePhaseId.make("phase-1"));
      expect(phaseEvent.payload.approval).toBe("approved");
    }
  });

  it("emits weave.node-verified + weave.phase-approved + weave.exited when this completes the last phase", async () => {
    const p = buildRunningProjection({
      nodes: [
        { id: "node-1", phaseId: "phase-1", status: "verified" },
        { id: "node-2", phaseId: "phase-1", status: "running" }, // verifying this one
      ],
      phases: [{ id: "phase-1", ordinal: 0 }], // only phase
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.verified",
          commandId: CommandId.make("cmd-v"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-2"),
          verifierOutcome: "Everything verified.",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("weave.node-verified");
    expect(events[1]?.type).toBe("weave.phase-approved");
    expect(events[2]?.type).toBe("weave.exited");
    const exitEvent = events[2];
    if (exitEvent !== undefined && exitEvent.type === "weave.exited") {
      expect(exitEvent.payload.reason).toBe("complete");
    }
  });

  it("rejects when verifierOutcome is empty string", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "running" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.verified",
            commandId: CommandId.make("cmd-v"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            verifierOutcome: "   ", // whitespace-only
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("non-empty");
  });

  it("rejects when node is not in running status", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "pending" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.verified",
            commandId: CommandId.make("cmd-v"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            verifierOutcome: "Done.",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("status is 'pending'");
  });
});

describe("decideWeaveCommand — weave.node.failed", () => {
  it("emits weave.node-failed when node is running", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "running" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.failed",
          commandId: CommandId.make("cmd-f"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          reason: "Timed out after 60s.",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-failed");
    const first = events[0];
    if (first !== undefined && first.type === "weave.node-failed") {
      expect(first.payload.reason).toBe("Timed out after 60s.");
      expect(first.payload.nodeId).toBe(WeaveNodeId.make("node-1"));
    }
  });

  it("rejects when node is not in running status", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "pending" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.failed",
            commandId: CommandId.make("cmd-f"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            reason: "failed",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("status is 'pending'");
  });
});

describe("decideWeaveCommand — weave.decision.resolve", () => {
  it("emits weave.decision-resolved when decision is open", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "ready" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const projectionWithOpenDecision: WeaveRunProjection = {
      ...p,
      openDecisions: new Set([WeaveDecisionId.make("decision-1")]),
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: projectionWithOpenDecision,
        command: {
          type: "weave.decision.resolve",
          commandId: CommandId.make("cmd-dr"),
          weaveRunId: WeaveRunId.make("run-1"),
          decisionId: WeaveDecisionId.make("decision-1"),
          answer: "Option A",
          byUser: true,
          rationale: "Rationale here",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.decision-resolved");
    const first = events[0];
    if (first !== undefined && first.type === "weave.decision-resolved") {
      expect(first.payload.decisionId).toBe(WeaveDecisionId.make("decision-1"));
      expect(first.payload.answer).toBe("Option A");
      expect(first.payload.byUser).toBe(true);
      expect(first.payload.rationale).toBe("Rationale here");
    }
  });

  it("emits weave.decision-resolved without rationale when rationale is undefined", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "ready" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const projectionWithOpenDecision: WeaveRunProjection = {
      ...p,
      openDecisions: new Set([WeaveDecisionId.make("decision-2")]),
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: projectionWithOpenDecision,
        command: {
          type: "weave.decision.resolve",
          commandId: CommandId.make("cmd-dr"),
          weaveRunId: WeaveRunId.make("run-1"),
          decisionId: WeaveDecisionId.make("decision-2"),
          answer: "Option B",
          byUser: false,
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    const first = events[0];
    if (first !== undefined && first.type === "weave.decision-resolved") {
      expect(first.payload.rationale).toBeUndefined();
    }
  });

  it("rejects when decision is not open", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "ready" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    // No open decisions in projection
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.decision.resolve",
            commandId: CommandId.make("cmd-dr"),
            weaveRunId: WeaveRunId.make("run-1"),
            decisionId: WeaveDecisionId.make("decision-1"),
            answer: "Option A",
            byUser: true,
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("not open");
  });
});

describe("decideWeaveCommand — weave.phase.approve", () => {
  it("emits single weave.phase-approved event when non-last phase is approved", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", phaseId: "phase-1", status: "verified" }],
      phases: [
        { id: "phase-1", ordinal: 0 },
        { id: "phase-2", ordinal: 1 },
      ],
    });
    const projectionWithPendingPhase: WeaveRunProjection = {
      ...p,
      phaseApprovals: new Map([[WeavePhaseId.make("phase-1"), "pending" as const]]),
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: projectionWithPendingPhase,
        command: {
          type: "weave.phase.approve",
          commandId: CommandId.make("cmd-pa"),
          weaveRunId: WeaveRunId.make("run-1"),
          phaseId: WeavePhaseId.make("phase-1"),
          approval: "approved",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.phase-approved");
  });

  it("emits weave.phase-approved + weave.exited when last phase is approved", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", phaseId: "phase-1", status: "verified" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const projectionWithPendingPhase: WeaveRunProjection = {
      ...p,
      phaseApprovals: new Map([[WeavePhaseId.make("phase-1"), "pending" as const]]),
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: projectionWithPendingPhase,
        command: {
          type: "weave.phase.approve",
          commandId: CommandId.make("cmd-pa"),
          weaveRunId: WeaveRunId.make("run-1"),
          phaseId: WeavePhaseId.make("phase-1"),
          approval: "approved",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("weave.phase-approved");
    expect(events[1]?.type).toBe("weave.exited");
    const exitEvent = events[1];
    if (exitEvent !== undefined && exitEvent.type === "weave.exited") {
      expect(exitEvent.payload.reason).toBe("complete");
    }
  });

  it("emits single weave.phase-approved event (no exit) when last phase is rejected", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", phaseId: "phase-1", status: "verified" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const projectionWithPendingPhase: WeaveRunProjection = {
      ...p,
      phaseApprovals: new Map([[WeavePhaseId.make("phase-1"), "pending" as const]]),
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: projectionWithPendingPhase,
        command: {
          type: "weave.phase.approve",
          commandId: CommandId.make("cmd-pa"),
          weaveRunId: WeaveRunId.make("run-1"),
          phaseId: WeavePhaseId.make("phase-1"),
          approval: "rejected",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.phase-approved");
    const first = events[0];
    if (first !== undefined && first.type === "weave.phase-approved") {
      expect(first.payload.approval).toBe("rejected");
    }
  });

  it("rejects when phase is not pending", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", phaseId: "phase-1", status: "verified" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const projectionWithApprovedPhase: WeaveRunProjection = {
      ...p,
      phaseApprovals: new Map([[WeavePhaseId.make("phase-1"), "approved" as const]]),
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: projectionWithApprovedPhase,
          command: {
            type: "weave.phase.approve",
            commandId: CommandId.make("cmd-pa"),
            weaveRunId: WeaveRunId.make("run-1"),
            phaseId: WeavePhaseId.make("phase-1"),
            approval: "approved",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("expected 'pending'");
  });
});

describe("decideWeaveCommand — weave.node.retry", () => {
  it("emits weave.node-retry-requested when node is failed", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "failed" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.retry",
          commandId: CommandId.make("cmd-retry"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-retry-requested");
    const first = events[0];
    if (first !== undefined && first.type === "weave.node-retry-requested") {
      expect(first.payload.nodeId).toBe(WeaveNodeId.make("node-1"));
    }
  });

  it("rejects when node is not failed", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "running" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.retry",
            commandId: CommandId.make("cmd-retry"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("status is 'running'");
  });
});

describe("decideWeaveCommand — weave.node.restart", () => {
  it("emits weave.node-restart-requested when node is failed", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "failed" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.node.restart",
          commandId: CommandId.make("cmd-restart"),
          weaveRunId: WeaveRunId.make("run-1"),
          nodeId: WeaveNodeId.make("node-1"),
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.node-restart-requested");
    const first = events[0];
    if (first !== undefined && first.type === "weave.node-restart-requested") {
      expect(first.payload.nodeId).toBe(WeaveNodeId.make("node-1"));
    }
  });

  it("rejects when node is not failed", async () => {
    const p = buildRunningProjection({
      nodes: [{ id: "node-1", status: "verified" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.node.restart",
            commandId: CommandId.make("cmd-restart"),
            weaveRunId: WeaveRunId.make("run-1"),
            nodeId: WeaveNodeId.make("node-1"),
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("status is 'verified'");
  });
});
