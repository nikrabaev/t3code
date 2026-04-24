import {
  Blueprint,
  BlueprintVersion,
  CommandId,
  ProjectId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { WeaveEngineLive } from "./WeaveEngine.ts";
import { WeavePlannerLive } from "./WeavePlanner.ts";
import { WeavePlanner } from "../Services/WeavePlanner.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import { PlannerDriver, PlannerDriverError } from "../Services/PlannerDriver.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

const asProjectId = (value: string): ProjectId => ProjectId.make(value);

function makeValidBlueprint(): Blueprint {
  const phaseId = WeavePhaseId.make("phase-test-1");
  const nodeId = WeaveNodeId.make("node-test-1");
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: nodeId,
        title: "Test Node",
        description: "A test implementation node",
        kind: "raw",
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: [],
        status: "pending",
      },
    ],
    phases: [
      {
        id: phaseId,
        ordinal: 0,
        title: "Phase 1",
        description: "First phase",
        approval: "pending",
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: now(),
    compiledBy: "planner",
  });
}

// ── Stub PlannerDriver ────────────────────────────────────────────────────────

/**
 * Create a stub PlannerDriver layer whose compile() calls return items from
 * `outputs` in sequence. If `outputs[i]` is a string it's treated as raw JSON
 * to return; if it's an Error the stub throws a PlannerDriverError.
 */
function makeStubPlannerDriver(outputs: ReadonlyArray<string | Error>): Layer.Layer<PlannerDriver> {
  let callIndex = 0;
  return Layer.succeed(
    PlannerDriver,
    PlannerDriver.of({
      compile: (_input) => {
        const idx = callIndex++;
        const output = outputs[idx];
        if (output === undefined) {
          return Effect.fail(
            new PlannerDriverError({ reason: "stub: no more outputs configured" }),
          );
        }
        if (output instanceof Error) {
          return Effect.fail(new PlannerDriverError({ reason: output.message }));
        }
        return Effect.succeed(output);
      },
    }),
  );
}

// ── System factory ────────────────────────────────────────────────────────────

async function createPlannerSystem(
  stubDriverOutputs: ReadonlyArray<string | Error>,
  testPrefix: string,
) {
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), { prefix: testPrefix });
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolverLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const weaveEngineLayer = WeaveEngineLive.pipe(Layer.provide(orchestrationLayer));
  const stubDriverLayer = makeStubPlannerDriver(stubDriverOutputs);
  const plannerLayer = WeavePlannerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(stubDriverLayer),
  );

  // Expose both WeavePlanner and WeaveEngineService to the runtime
  const appLayer = plannerLayer.pipe(Layer.provideMerge(weaveEngineLayer));

  const runtime = ManagedRuntime.make(appLayer);

  const { planner, weaveEngine } = await runtime.runPromise(
    Effect.gen(function* () {
      return {
        planner: yield* WeavePlanner,
        weaveEngine: yield* WeaveEngineService,
      };
    }),
  );

  return {
    planner,
    weaveEngine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WeavePlanner", () => {
  it("happy path: valid Blueprint on first attempt transitions run to 'reviewing'", async () => {
    const blueprint = makeValidBlueprint();
    const rawJson = JSON.stringify(Schema.encodeSync(Blueprint)(blueprint));

    const system = await createPlannerSystem([rawJson], "t3-weave-planner-happy-");
    const { planner, weaveEngine } = system;

    const runId = WeaveRunId.make("run-planner-happy-1");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* planner.start();
          // Give the subscriber fiber time to subscribe to the PubSub before
          // dispatching — same pattern as WeaveEngine.test.ts stream test.
          yield* Effect.sleep("20 millis");

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-planner-happy-create"),
            weaveRunId: runId,
            projectId: asProjectId("project-planner-happy"),
            title: "Happy Path Weave",
            vision: "Build something great",
            createdAt: now(),
          });

          yield* planner.drain;
        }),
      ),
    );

    const projection = await system.run(weaveEngine.getWeaveRun(runId));

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("reviewing");
    expect(projection?.currentBlueprint).not.toBeNull();
    expect(projection?.currentBlueprint?.nodes.length).toBe(1);

    await system.dispose();
  });

  it("retry-then-success: invalid JSON first, valid Blueprint on second attempt", async () => {
    const blueprint = makeValidBlueprint();
    const rawJson = JSON.stringify(Schema.encodeSync(Blueprint)(blueprint));

    const system = await createPlannerSystem(
      ["not valid json {{{{", rawJson],
      "t3-weave-planner-retry-",
    );
    const { planner, weaveEngine } = system;

    const runId = WeaveRunId.make("run-planner-retry-1");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* planner.start();
          yield* Effect.sleep("20 millis");

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-planner-retry-create"),
            weaveRunId: runId,
            projectId: asProjectId("project-planner-retry"),
            title: "Retry Weave",
            vision: "Build something great on retry",
            createdAt: now(),
          });

          yield* planner.drain;
        }),
      ),
    );

    const projection = await system.run(weaveEngine.getWeaveRun(runId));

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("reviewing");
    expect(projection?.currentBlueprint).not.toBeNull();

    await system.dispose();
  });

  it("double failure: both attempts fail, run transitions to 'aborted'", async () => {
    const system = await createPlannerSystem(
      [new Error("driver error 1"), new Error("driver error 2")],
      "t3-weave-planner-double-fail-",
    );
    const { planner, weaveEngine } = system;

    const runId = WeaveRunId.make("run-planner-double-fail-1");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* planner.start();
          yield* Effect.sleep("20 millis");

          yield* weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-planner-fail-create"),
            weaveRunId: runId,
            projectId: asProjectId("project-planner-fail"),
            title: "Failing Weave",
            vision: "This weave will fail",
            createdAt: now(),
          });

          yield* planner.drain;
        }),
      ),
    );

    const projection = await system.run(weaveEngine.getWeaveRun(runId));

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("aborted");

    await system.dispose();
  });
});
