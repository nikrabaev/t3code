import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { WeavePlanner } from "../Services/WeavePlanner.ts";
import { WeaveScheduler } from "../Services/WeaveScheduler.ts";
import { WeaveContractConformer } from "../Services/WeaveContractConformer.ts";
import { WeaveNodeRestarter } from "../Services/WeaveNodeRestarter.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const weavePlanner = yield* WeavePlanner;
  const weaveScheduler = yield* WeaveScheduler;
  const weaveContractConformer = yield* WeaveContractConformer;
  const weaveNodeRestarter = yield* WeaveNodeRestarter;

  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* providerRuntimeIngestion.start();
    yield* providerCommandReactor.start();
    yield* checkpointReactor.start();
    yield* threadDeletionReactor.start();
    yield* weavePlanner.start();
    yield* weaveScheduler.start();
    yield* weaveContractConformer.start();
    yield* weaveNodeRestarter.start();
  });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
