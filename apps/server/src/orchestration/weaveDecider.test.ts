import { CommandId, ProjectId, WeaveRunId } from "@t3tools/contracts";
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
