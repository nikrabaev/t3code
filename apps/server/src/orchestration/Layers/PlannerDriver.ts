/**
 * PlannerDriverLive — real PlannerDriver that invokes ProviderService.
 *
 * Flow per compile() call:
 *  1. Read planner settings (provider, modelSelection) from ServerSettingsService.
 *  2. Compute deterministic threadId = `planner-${weaveRunId}`.
 *  3. Dispatch weave.planner.thread-created (idempotent: projector upserts).
 *  4. Start a provider session for that threadId.
 *  5. Build prompt via buildPlannerPrompt, send via sendTurn.
 *  6. Subscribe to streamEvents filtered to this threadId; accumulate
 *     content.delta payloads (streamKind === "assistant_text") until
 *     turn.completed or turn.aborted.
 *  7. Always stop the session (Effect.ensuring / best-effort).
 *  8. Return the accumulated text.
 *
 * @module PlannerDriverLive
 */
import { EventId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Ref, Stream } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { PlannerDriver, PlannerDriverError } from "../Services/PlannerDriver.ts";
import { buildPlannerPrompt } from "./plannerPrompt.ts";

const toPlannerDriverError = (e: unknown): PlannerDriverError =>
  new PlannerDriverError({ reason: e instanceof Error ? e.message : String(e) });

export const PlannerDriverLive = Layer.effect(
  PlannerDriver,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const settingsService = yield* ServerSettingsService;
    const engine = yield* OrchestrationEngineService;

    return PlannerDriver.of({
      compile: (input) =>
        Effect.gen(function* () {
          const settings = yield* settingsService.getSettings.pipe(
            Effect.mapError(toPlannerDriverError),
          );
          const plannerSettings = settings.weave.planner;

          const threadId = ThreadId.make(`planner-${input.weaveRunId}`);
          const occurredAt = new Date().toISOString();

          // Step 3: Materialize the synthetic planner thread (idempotent — projector upserts).
          yield* engine
            .appendSystemEvent({
              eventId: EventId.make(crypto.randomUUID()),
              aggregateKind: "weave",
              aggregateId: input.weaveRunId,
              type: "weave.planner.thread-created",
              occurredAt,
              commandId: null,
              causationEventId: null,
              correlationId: null,
              metadata: {},
              payload: {
                weaveRunId: input.weaveRunId,
                threadId,
                projectId: input.projectId,
                title: `Weave planner: ${input.parentThreadTitle}`,
                occurredAt,
              },
            })
            .pipe(Effect.mapError(toPlannerDriverError));

          // Step 4: Start provider session.
          yield* providerService
            .startSession(threadId, {
              threadId,
              provider: plannerSettings.provider,
              modelSelection: plannerSettings.modelSelection,
              cwd: input.projectWorkspaceRoot,
              runtimeMode: "full-access",
            })
            .pipe(Effect.mapError(toPlannerDriverError));

          // Steps 5–7: send turn, accumulate, always stop.
          return yield* Effect.gen(function* () {
            const prompt = buildPlannerPrompt({
              vision: input.vision,
              snapshotContent: input.snapshotContent,
              ...(input.projectVerifierCommand !== undefined
                ? { projectVerifierCommand: input.projectVerifierCommand }
                : {}),
              ...(input.previousError !== undefined ? { previousError: input.previousError } : {}),
            });

            // Step 5: Send turn.
            yield* providerService
              .sendTurn({ threadId, input: prompt })
              .pipe(Effect.mapError(toPlannerDriverError));

            // Step 6: Accumulate content.delta until turn.completed or turn.aborted.
            const accumulator = yield* Ref.make("");

            yield* Stream.runForEach(
              providerService.streamEvents.pipe(
                Stream.filter((e) => e.threadId === threadId),
                Stream.takeUntil((e) => e.type === "turn.completed" || e.type === "turn.aborted"),
              ),
              (event) => {
                if (
                  event.type === "content.delta" &&
                  event.payload.streamKind === "assistant_text"
                ) {
                  return Ref.update(accumulator, (s) => s + event.payload.delta);
                }
                return Effect.void;
              },
            ).pipe(Effect.mapError(toPlannerDriverError));

            const text = yield* Ref.get(accumulator);
            if (text.trim() === "") {
              // eslint-disable-next-line effect/no-unnecessary-fail-yieldable-error
              return yield* Effect.fail(
                new PlannerDriverError({ reason: "planner returned empty output" }),
              );
            }
            return text;
          }).pipe(Effect.ensuring(providerService.stopSession({ threadId }).pipe(Effect.ignore)));
        }),
    });
  }),
);
