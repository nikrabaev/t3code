import {
  BlueprintVersion,
  CommandId,
  ProjectId,
  WeaveRunId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";
import { createEmptyWeaveProjection } from "./weaveProjector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asWeaveRunId = (value: string): WeaveRunId => WeaveRunId.make(value);

const now = new Date().toISOString();

describe("decider weave routes", () => {
  it("weave.create command → emits weave.created when run does not exist", async () => {
    const readModel: OrchestrationReadModel = createEmptyReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "weave.create",
          commandId: asCommandId("cmd-weave-create-1"),
          weaveRunId: asWeaveRunId("run-1"),
          projectId: asProjectId("project-1"),
          title: "Test Weave Run",
          vision: "# Build a sample system",
          createdAt: now,
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.created");
    expect(events[0]?.aggregateKind).toBe("weave");
    expect(events[0]?.aggregateId).toBe(asWeaveRunId("run-1"));
  });

  it("weave.create command → rejects when run already exists in read model", async () => {
    const readModel: OrchestrationReadModel = {
      ...createEmptyReadModel(now),
      weaveRuns: new Map([
        [
          asWeaveRunId("run-1"),
          createEmptyWeaveProjection({
            id: asWeaveRunId("run-1"),
            projectId: asProjectId("project-1"),
            title: "Existing Run",
            vision: "",
            status: "draft",
            concurrencyCap: 1,
            createdAt: now,
          }),
        ],
      ]),
    };

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "weave.create",
            commandId: asCommandId("cmd-weave-create-2"),
            weaveRunId: asWeaveRunId("run-1"),
            projectId: asProjectId("project-1"),
            title: "Duplicate Run",
            vision: "",
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("weave.blueprint.approve command → rejects when run is in draft status", async () => {
    const readModel: OrchestrationReadModel = {
      ...createEmptyReadModel(now),
      weaveRuns: new Map([
        [
          asWeaveRunId("run-1"),
          createEmptyWeaveProjection({
            id: asWeaveRunId("run-1"),
            projectId: asProjectId("project-1"),
            title: "Draft Run",
            vision: "",
            status: "draft",
            concurrencyCap: 1,
            createdAt: now,
          }),
        ],
      ]),
    };

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "weave.blueprint.approve",
            commandId: asCommandId("cmd-blueprint-approve-1"),
            weaveRunId: asWeaveRunId("run-1"),
            blueprintVersion: BlueprintVersion.make(1),
            concurrencyCap: 1,
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("weave run status is 'draft'; expected one of [reviewing].");
  });
});
