import {
  BlueprintVersion,
  CommandId,
  ProjectId,
  WeaveCommand,
  WeaveDecisionId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  requireAncestorsVerified,
  requireBlueprintVersion,
  requireNode,
  requireNodeStatus,
  requireOpenDecision,
  requirePhasePending,
  requireRun,
  requireRunAbsent,
  requireRunNotTerminal,
  requireStatus,
} from "./weaveCommandInvariants.ts";
import { createEmptyWeaveProjection, type WeaveRunProjection } from "./weaveProjector.ts";

const now = new Date().toISOString();

const sampleCommand: WeaveCommand = {
  type: "weave.create",
  commandId: CommandId.make("cmd-1"),
  weaveRunId: WeaveRunId.make("run-1"),
  projectId: ProjectId.make("project-1"),
  title: "X",
  vision: "",
  createdAt: now,
};

const emptyProjection = (): WeaveRunProjection =>
  createEmptyWeaveProjection({
    id: WeaveRunId.make("run-1"),
    projectId: ProjectId.make("project-1"),
    title: "X",
    vision: "",
    status: "draft",
    concurrencyCap: 1,
    planningDepthCap: 3,
    createdAt: now,
  });

describe("weaveCommandInvariants", () => {
  it("requireRunAbsent: passes when projection is null", async () => {
    await Effect.runPromise(requireRunAbsent({ projection: null, command: sampleCommand }));
  });

  it("requireRunAbsent: rejects when a projection already exists", async () => {
    await expect(
      Effect.runPromise(
        requireRunAbsent({ projection: emptyProjection(), command: sampleCommand }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("requireRun: returns the projection when present", async () => {
    const p = await Effect.runPromise(
      requireRun({ projection: emptyProjection(), command: sampleCommand }),
    );
    expect(p.run.id).toBe(WeaveRunId.make("run-1"));
  });

  it("requireRun: rejects when null", async () => {
    await expect(
      Effect.runPromise(requireRun({ projection: null, command: sampleCommand })),
    ).rejects.toThrow("does not exist");
  });

  it("requireStatus: passes when in allowed list", async () => {
    await Effect.runPromise(
      requireStatus({
        projection: emptyProjection(),
        command: sampleCommand,
        allowed: ["draft", "reviewing"],
      }),
    );
  });

  it("requireStatus: rejects when not in allowed list", async () => {
    await expect(
      Effect.runPromise(
        requireStatus({
          projection: emptyProjection(),
          command: sampleCommand,
          allowed: ["running"],
        }),
      ),
    ).rejects.toThrow("expected one of [running]");
  });

  it("requireRunNotTerminal: passes for draft / reviewing / running / paused", async () => {
    for (const s of ["draft", "reviewing", "running", "paused"] as const) {
      const p = { ...emptyProjection(), run: { ...emptyProjection().run, status: s } };
      await Effect.runPromise(requireRunNotTerminal({ projection: p, command: sampleCommand }));
    }
  });

  it("requireRunNotTerminal: rejects complete and aborted", async () => {
    for (const s of ["complete", "aborted"] as const) {
      const p = { ...emptyProjection(), run: { ...emptyProjection().run, status: s } };
      await expect(
        Effect.runPromise(requireRunNotTerminal({ projection: p, command: sampleCommand })),
      ).rejects.toThrow("already terminated");
    }
  });

  it("requireBlueprintVersion: passes on exact match against the compiled blueprint", async () => {
    const p = {
      ...emptyProjection(),
      currentBlueprint: {
        version: BlueprintVersion.make(2),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner" as const,
      },
    };
    await Effect.runPromise(
      requireBlueprintVersion({
        projection: p,
        command: sampleCommand,
        version: BlueprintVersion.make(2),
      }),
    );
  });

  it("requireBlueprintVersion: rejects on mismatch against the compiled blueprint", async () => {
    const p = {
      ...emptyProjection(),
      currentBlueprint: {
        version: BlueprintVersion.make(2),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner" as const,
      },
    };
    await expect(
      Effect.runPromise(
        requireBlueprintVersion({
          projection: p,
          command: sampleCommand,
          version: BlueprintVersion.make(3),
        }),
      ),
    ).rejects.toThrow("blueprint version mismatch");
  });

  it("requireBlueprintVersion: rejects when no blueprint has been compiled", async () => {
    await expect(
      Effect.runPromise(
        requireBlueprintVersion({
          projection: emptyProjection(),
          command: sampleCommand,
          version: BlueprintVersion.make(1),
        }),
      ),
    ).rejects.toThrow("blueprint version mismatch");
  });

  it("requireNode: rejects when blueprint is null", async () => {
    await expect(
      Effect.runPromise(
        requireNode({
          projection: emptyProjection(),
          command: sampleCommand,
          nodeId: WeaveNodeId.make("node-1"),
        }),
      ),
    ).rejects.toThrow("no current blueprint");
  });

  it("requireNodeStatus: rejects unknown node", async () => {
    await expect(
      Effect.runPromise(
        requireNodeStatus({
          projection: emptyProjection(),
          command: sampleCommand,
          nodeId: WeaveNodeId.make("node-x"),
          allowed: ["running"],
        }),
      ),
    ).rejects.toThrow("status is 'unknown'");
  });

  it("requireOpenDecision: passes when in openDecisions set", async () => {
    const p = {
      ...emptyProjection(),
      openDecisions: new Set([WeaveDecisionId.make("decision-1")]),
    };
    await Effect.runPromise(
      requireOpenDecision({
        projection: p,
        command: sampleCommand,
        decisionId: WeaveDecisionId.make("decision-1"),
      }),
    );
  });

  it("requireOpenDecision: rejects when not in openDecisions", async () => {
    await expect(
      Effect.runPromise(
        requireOpenDecision({
          projection: emptyProjection(),
          command: sampleCommand,
          decisionId: WeaveDecisionId.make("decision-z"),
        }),
      ),
    ).rejects.toThrow("is not open");
  });

  it("requirePhasePending: passes when phase absent from approvals map (default pending)", async () => {
    await Effect.runPromise(
      requirePhasePending({
        projection: emptyProjection(),
        command: sampleCommand,
        phaseId: WeavePhaseId.make("phase-1"),
      }),
    );
  });

  it("requirePhasePending: rejects when phase approved", async () => {
    const p = {
      ...emptyProjection(),
      phaseApprovals: new Map([[WeavePhaseId.make("phase-1"), "approved" as const]]),
    };
    await expect(
      Effect.runPromise(
        requirePhasePending({
          projection: p,
          command: sampleCommand,
          phaseId: WeavePhaseId.make("phase-1"),
        }),
      ),
    ).rejects.toThrow("expected 'pending'");
  });
});

describe("requireAncestorsVerified", () => {
  it("passes when the node has no ancestors", async () => {
    const node = {
      id: WeaveNodeId.make("solo"),
      title: "solo" as unknown as ReturnType<typeof WeaveNodeId.make>,
      description: "",
      kind: "raw" as const,
      phaseId: WeavePhaseId.make("phase-1"),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [],
      status: "ready" as const,
    };
    await Effect.runPromise(
      requireAncestorsVerified({ projection: emptyProjection(), command: sampleCommand, node }),
    );
  });

  it("passes when all ancestors are verified", async () => {
    const ancestorId = WeaveNodeId.make("parent");
    const p = {
      ...emptyProjection(),
      nodeMeta: new Map([[ancestorId, { status: "verified" as const }]]),
    };
    const node = {
      id: WeaveNodeId.make("child"),
      title: "child" as unknown as ReturnType<typeof WeaveNodeId.make>,
      description: "",
      kind: "raw" as const,
      phaseId: WeavePhaseId.make("phase-1"),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [ancestorId],
      status: "ready" as const,
    };
    await Effect.runPromise(
      requireAncestorsVerified({ projection: p, command: sampleCommand, node }),
    );
  });

  it("rejects when an ancestor is not verified", async () => {
    const ancestorId = WeaveNodeId.make("parent");
    const p = {
      ...emptyProjection(),
      nodeMeta: new Map([[ancestorId, { status: "running" as const }]]),
    };
    const node = {
      id: WeaveNodeId.make("child"),
      title: "child" as unknown as ReturnType<typeof WeaveNodeId.make>,
      description: "",
      kind: "raw" as const,
      phaseId: WeavePhaseId.make("phase-1"),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [ancestorId],
      status: "ready" as const,
    };
    await expect(
      Effect.runPromise(requireAncestorsVerified({ projection: p, command: sampleCommand, node })),
    ).rejects.toThrow("ancestor");
  });

  it("rejects with 'unknown' status when ancestor absent from nodeMeta", async () => {
    const ancestorId = WeaveNodeId.make("ghost-parent");
    const node = {
      id: WeaveNodeId.make("child"),
      title: "child" as unknown as ReturnType<typeof WeaveNodeId.make>,
      description: "",
      kind: "raw" as const,
      phaseId: WeavePhaseId.make("phase-1"),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [ancestorId],
      status: "ready" as const,
    };
    await expect(
      Effect.runPromise(
        requireAncestorsVerified({ projection: emptyProjection(), command: sampleCommand, node }),
      ),
    ).rejects.toThrow("unknown");
  });
});
