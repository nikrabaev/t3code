import { CommandId, ProjectId, WeaveRunId, BlueprintVersion } from "@t3tools/contracts";
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
  it("emits weave.blueprint-approved when version matches and run is reviewing", async () => {
    const base = emptyProjection();
    const p: WeaveRunProjection = {
      ...base,
      run: {
        ...base.run,
        status: "reviewing",
        currentBlueprintVersion: BlueprintVersion.make(1),
      },
    };
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
    const base = emptyProjection();
    const p: WeaveRunProjection = {
      ...base,
      run: {
        ...base.run,
        status: "reviewing",
        currentBlueprintVersion: BlueprintVersion.make(1),
      },
    };
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
