/**
 * WeavePlannerLive - Layer implementation of the WeavePlanner service.
 *
 * Processing loop (per weave.created event):
 *  1. Call plannerDriver.compile({ vision, snapshotContent })
 *  2. Parse raw output as JSON → try/catch
 *  3. Decode via Schema.decodeUnknownSync(Blueprint) inside Effect.try
 *  4. On success: weaveEngine.persistPlannerEvent(...)
 *  5. On failure: retry once with previousError. On second failure:
 *     weaveEngine.dispatchWeaveCommand({ type: "weave.exit", reason: "aborted" })
 *
 * @module WeavePlannerLive
 */
import { Blueprint, BlueprintSource, CommandId } from "@t3tools/contracts";
import { Cause, Effect, Exit, Layer, Schema, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import {
  PlannerDriver,
  PlannerDriverError,
  type PlannerDriverShape,
} from "../Services/PlannerDriver.ts";
import { WeavePlanner, type WeavePlannerShape } from "../Services/WeavePlanner.ts";
import { WeaveEngineService, type WeaveEngineShape } from "../Services/WeaveEngine.ts";
import type { WeaveOrchestrationEvent } from "../weaveProjector.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

type WeaveCreatedEvent = Extract<WeaveOrchestrationEvent, { type: "weave.created" }>;

/**
 * Attempt to compile a Blueprint from raw text: JSON.parse + Schema.decodeUnknownSync.
 * Returns the decoded Blueprint or an error string describing what went wrong.
 */
function tryDecodeBlueprintText(rawText: string): Blueprint | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  const exit = Schema.decodeUnknownExit(Blueprint)(parsed);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  return `Blueprint decode failed: ${Cause.pretty(exit.cause)}`;
}

/**
 * One attempt: drive → decode. Returns Blueprint on success or error string on failure.
 */
const attemptCompile = (
  driver: PlannerDriverShape,
  input: { vision: string; snapshotContent: string; previousError?: string },
): Effect.Effect<Blueprint | string, never> =>
  driver.compile(input).pipe(
    Effect.map((rawText) => tryDecodeBlueprintText(rawText)),
    Effect.catchTag("PlannerDriverError", (e: PlannerDriverError) =>
      Effect.succeed(`PlannerDriver error: ${e.reason}` as string),
    ),
  );

/**
 * Process a single weave.created event: compile → decode → persist or abort.
 */
const processWeaveCreated = Effect.fn("WeavePlanner.processWeaveCreated")(function* (
  event: WeaveCreatedEvent,
  weaveEngine: WeaveEngineShape,
  plannerDriver: PlannerDriverShape,
) {
  const { weaveRunId, vision, snapshotContent = "" } = event.payload;
  const correlationCommandId = event.commandId ?? undefined;

  yield* Effect.log("WeavePlanner: compiling blueprint for run", { weaveRunId });

  // First attempt
  const firstResult = yield* attemptCompile(plannerDriver, { vision, snapshotContent });

  if (typeof firstResult !== "string") {
    const blueprint = firstResult;
    yield* weaveEngine.persistPlannerEvent({
      runId: weaveRunId,
      blueprint,
      compiledBy: BlueprintSource.make("planner"),
      ...(correlationCommandId !== undefined ? { correlationCommandId } : {}),
    });
    yield* Effect.log("WeavePlanner: blueprint persisted", {
      weaveRunId,
      nodeCount: blueprint.nodes.length,
    });
    return;
  }

  const firstError = firstResult;
  yield* Effect.logWarning("WeavePlanner: first compile attempt failed, retrying", {
    weaveRunId,
    error: firstError,
  });

  // Retry once with previousError context
  const secondResult = yield* attemptCompile(plannerDriver, {
    vision,
    snapshotContent,
    previousError: firstError,
  });

  if (typeof secondResult !== "string") {
    const blueprint = secondResult;
    yield* weaveEngine.persistPlannerEvent({
      runId: weaveRunId,
      blueprint,
      compiledBy: BlueprintSource.make("planner"),
      ...(correlationCommandId !== undefined ? { correlationCommandId } : {}),
    });
    yield* Effect.log("WeavePlanner: blueprint persisted on retry", {
      weaveRunId,
      nodeCount: blueprint.nodes.length,
    });
    return;
  }

  const secondError = secondResult;
  yield* Effect.logError("WeavePlanner: both compile attempts failed — aborting run", {
    weaveRunId,
    firstError,
    secondError,
  });

  // Both attempts failed: dispatch weave.exit with reason: "aborted"
  yield* weaveEngine
    .dispatchWeaveCommand({
      type: "weave.exit",
      commandId: serverCommandId("planner-abort"),
      weaveRunId,
      reason: "aborted",
      createdAt: new Date().toISOString(),
    })
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logError("WeavePlanner: failed to dispatch weave.exit after compile failure", {
          weaveRunId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
});

const make = Effect.gen(function* () {
  const weaveEngine = yield* WeaveEngineService;
  const plannerDriver = yield* PlannerDriver;

  const processEvent = (event: WeaveCreatedEvent) =>
    processWeaveCreated(event, weaveEngine, plannerDriver).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logError("WeavePlanner: unexpected error processing weave.created", {
          eventId: event.eventId,
          weaveRunId: event.payload.weaveRunId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEvent);

  const start: WeavePlannerShape["start"] = () =>
    Effect.forkScoped(
      Stream.runForEach(
        weaveEngine.streamWeaveEvents.pipe(
          Stream.filter((e): e is WeaveCreatedEvent => e.type === "weave.created"),
        ),
        (event) => worker.enqueue(event),
      ),
    ).pipe(Effect.asVoid);

  return {
    start,
    drain: worker.drain,
  } satisfies WeavePlannerShape;
});

export const WeavePlannerLive = Layer.effect(WeavePlanner, make);
