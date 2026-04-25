import { Layer } from "effect";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { GitCoreLive } from "../git/Layers/GitCore.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { PlannerDriverLive } from "./Layers/PlannerDriver.ts";
import { PlannerDriverPlaceholderLive } from "./Layers/PlannerDriverPlaceholder.ts";
import { ProcessRunnerLive } from "./Layers/ProcessRunner.ts";
import { RuntimeReceiptBusLive } from "./Layers/RuntimeReceiptBus.ts";
import { WeaveContractConformerLive } from "./Layers/WeaveContractConformer.ts";
import { WeaveEngineLive } from "./Layers/WeaveEngine.ts";
import { WeavePlannerLive } from "./Layers/WeavePlanner.ts";
import { WeaveSchedulerLive } from "./Layers/WeaveScheduler.ts";

export const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

export const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
);

export const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
);

const OrchestrationEngineFull = OrchestrationEngineLive.pipe(
  Layer.provide(OrchestrationInfrastructureLayerLive),
);

const WeaveEngineFull = WeaveEngineLive.pipe(Layer.provide(OrchestrationEngineFull));

// WeavePlannerFull uses the placeholder driver so that OrchestrationLayerLive
// remains self-contained (no external ProviderService / ServerSettingsService
// requirements). In the full server runtime server.ts overrides this by providing
// PlannerDriverFullLive before OrchestrationLayerLive in its composition chain.
const WeavePlannerFull = WeavePlannerLive.pipe(
  Layer.provide(WeaveEngineFull),
  Layer.provide(OrchestrationEngineFull),
  Layer.provide(PlannerDriverPlaceholderLive),
);

const WeaveSchedulerFull = WeaveSchedulerLive.pipe(
  Layer.provide(WeaveEngineFull),
  Layer.provide(OrchestrationEngineFull),
  Layer.provide(GitCoreLive),
);

const WeaveContractConformerFull = WeaveContractConformerLive.pipe(
  Layer.provide(WeaveEngineFull),
  Layer.provide(OrchestrationEngineFull),
  Layer.provide(RuntimeReceiptBusLive),
  Layer.provide(ProcessRunnerLive),
);

export const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineFull,
  WeaveEngineFull,
  WeavePlannerFull,
  WeaveSchedulerFull,
  ProcessRunnerLive,
  WeaveContractConformerFull,
  RuntimeReceiptBusLive,
  GitCoreLive,
);

/**
 * The real PlannerDriver wired to ProviderService + ServerSettingsService.
 *
 * OrchestrationEngineService is already satisfied internally (uses
 * OrchestrationEngineFull). ProviderService and ServerSettingsService must
 * come from the outer composition (server.ts provides them through
 * ProviderLayerLive and ServerSettingsLive respectively).
 *
 * Usage in server.ts: provide this layer on the WeavePlanner layer BEFORE
 * OrchestrationLayerLive, or use WeavePlannerWithRealDriverLive exported below.
 */
export const PlannerDriverFullLive = PlannerDriverLive.pipe(Layer.provide(OrchestrationEngineFull));

/**
 * WeavePlannerLive wired with the real PlannerDriver (for use in server.ts).
 *
 * Requires ProviderService + ServerSettingsService from the outer composition.
 * This replaces the WeavePlannerFull inside OrchestrationLayerLive when the
 * full server runtime merges this layer alongside OrchestrationLayerLive.
 */
export const WeavePlannerWithRealDriverLive = WeavePlannerLive.pipe(
  Layer.provide(WeaveEngineFull),
  Layer.provide(OrchestrationEngineFull),
  Layer.provide(PlannerDriverFullLive),
);
