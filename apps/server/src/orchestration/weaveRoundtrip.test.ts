import {
  BlueprintVersion,
  CommandId,
  ProjectId,
  ThreadId,
  WeaveCommand,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideWeaveCommand, type PlannedWeaveEvent } from "./weaveDecider.ts";
import {
  projectWeaveEvent,
  type WeaveOrchestrationEvent,
  type WeaveRunProjection,
} from "./weaveProjector.ts";

const now = new Date().toISOString();

// Helper: run a command, project each resulting event, return next projection + events.
async function step(
  projection: WeaveRunProjection | null,
  command: WeaveCommand,
): Promise<{ events: ReadonlyArray<PlannedWeaveEvent>; projection: WeaveRunProjection }> {
  const events = await Effect.runPromise(decideWeaveCommand({ projection, command }));
  let next: WeaveRunProjection | null = projection;
  for (const e of events) {
    const sequenced = { ...e, sequence: 0 } as WeaveOrchestrationEvent;
    next = await Effect.runPromise(projectWeaveEvent(next, sequenced));
  }
  return { events, projection: next! };
}

describe("weave decider+projector roundtrip", () => {
  it("walks a 2-node 1-phase run from create to complete", async () => {
    const runId = WeaveRunId.make("run-1");
    const phaseId = WeavePhaseId.make("phase-1");
    const nodeA = WeaveNodeId.make("node-a");
    const nodeB = WeaveNodeId.make("node-b");

    // 1. create
    const s1 = await step(null, {
      type: "weave.create",
      commandId: CommandId.make("cmd-create"),
      weaveRunId: runId,
      projectId: ProjectId.make("project-1"),
      title: "Roundtrip" as never,
      vision: "",
      createdAt: now,
    });
    expect(s1.projection.run.status).toBe("draft");

    // 2. simulate blueprint-compiled (decider returns [] for this command; planner emits directly).
    //    Hand-craft the event envelope and project it directly.
    const compiledEvent: WeaveOrchestrationEvent = {
      sequence: 0,
      eventId: "evt-compiled" as never,
      aggregateKind: "weave",
      aggregateId: runId,
      type: "weave.blueprint-compiled",
      occurredAt: now,
      commandId: CommandId.make("cmd-compile"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-compile"),
      metadata: {},
      payload: {
        weaveRunId: runId,
        version: BlueprintVersion.make(1),
        compiledBy: "planner",
        occurredAt: now,
        blueprint: {
          version: BlueprintVersion.make(1),
          nodes: [
            {
              id: nodeA,
              title: "A" as never,
              description: "",
              kind: "scaffold",
              phaseId,
              scope: { readSet: [], writeSet: [] },
              inputContractIds: [],
              outputContractIds: [],
              verifierDescription: "",
              dependsOn: [],
              status: "pending",
            },
            {
              id: nodeB,
              title: "B" as never,
              description: "",
              kind: "raw",
              phaseId,
              scope: { readSet: [], writeSet: [] },
              inputContractIds: [],
              outputContractIds: [],
              verifierDescription: "",
              dependsOn: [nodeA],
              status: "pending",
            },
          ],
          phases: [
            {
              id: phaseId,
              ordinal: 0,
              title: "Only Phase" as never,
              description: "",
              approval: "pending",
            },
          ],
          contracts: [],
          decisions: [],
          compiledAt: now,
          compiledBy: "planner",
        },
      },
    };
    const afterCompile = await Effect.runPromise(projectWeaveEvent(s1.projection, compiledEvent));
    expect(afterCompile.run.status).toBe("reviewing");

    // 3. approve blueprint
    const s3 = await step(afterCompile, {
      type: "weave.blueprint.approve",
      commandId: CommandId.make("cmd-approve"),
      weaveRunId: runId,
      blueprintVersion: BlueprintVersion.make(1),
      concurrencyCap: 1,
      createdAt: now,
    });
    expect(s3.projection.run.status).toBe("running");

    // 4. manually mark node-a ready (scheduler normally does this; decider requires "ready" before dispatch)
    const readyState: WeaveRunProjection = {
      ...s3.projection,
      nodeMeta: new Map(s3.projection.nodeMeta).set(nodeA, { status: "ready" }),
    };

    // 5. dispatch node-a
    const s5 = await step(readyState, {
      type: "weave.node.dispatch",
      commandId: CommandId.make("cmd-dispatch-a"),
      weaveRunId: runId,
      nodeId: nodeA,
      childThreadId: ThreadId.make("thread-a"),
      worktreePath: "/tmp/wt/a",
      createdAt: now,
    });
    expect(s5.projection.nodeMeta.get(nodeA)?.status).toBe("running");

    // 6. verify node-a — only 1 event (node-b still pending)
    const s6 = await step(s5.projection, {
      type: "weave.node.verified",
      commandId: CommandId.make("cmd-verified-a"),
      weaveRunId: runId,
      nodeId: nodeA,
      verifierOutcome: "tests-passed",
      createdAt: now,
    });
    expect(s6.events).toHaveLength(1);
    expect(s6.projection.nodeMeta.get(nodeA)?.status).toBe("verified");

    // 7. mark node-b ready
    const bReady: WeaveRunProjection = {
      ...s6.projection,
      nodeMeta: new Map(s6.projection.nodeMeta).set(nodeB, { status: "ready" }),
    };

    // 8. dispatch + verify node-b — verify should emit 3 events (verified + phase-approved + exited)
    const s8 = await step(bReady, {
      type: "weave.node.dispatch",
      commandId: CommandId.make("cmd-dispatch-b"),
      weaveRunId: runId,
      nodeId: nodeB,
      childThreadId: ThreadId.make("thread-b"),
      worktreePath: "/tmp/wt/b",
      createdAt: now,
    });
    const s9 = await step(s8.projection, {
      type: "weave.node.verified",
      commandId: CommandId.make("cmd-verified-b"),
      weaveRunId: runId,
      nodeId: nodeB,
      verifierOutcome: "tests-passed",
      createdAt: now,
    });
    expect(s9.events.map((e) => e.type)).toEqual([
      "weave.node-verified",
      "weave.phase-approved",
      "weave.exited",
    ]);
    expect(s9.projection.run.status).toBe("complete");
    expect(s9.projection.phaseApprovals.get(phaseId)).toBe("approved");
  });
});
