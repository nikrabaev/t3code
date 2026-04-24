/**
 * PlannerDriverLive - Default (placeholder) PlannerDriver layer.
 *
 * This layer is intentionally unimplemented in v0.1 (Slice 3). The real
 * provider integration ships in Slice 4 — see
 * docs/superpowers/followups/2026-04-24-weave-planner-provider-integration.md.
 *
 * Every call to `compile` fails with a PlannerDriverError so that WeavePlanner
 * routes the run to the "aborted" state instead of silently hanging. Tests
 * always inject their own stub driver layer and never reach this layer.
 *
 * @module PlannerDriverLive
 */
import { Effect, Layer } from "effect";

import { PlannerDriver, PlannerDriverError } from "../Services/PlannerDriver.ts";

export const PlannerDriverLive = Layer.succeed(
  PlannerDriver,
  PlannerDriver.of({
    compile: (_input) =>
      Effect.logWarning(
        "PlannerDriverLive: not yet integrated with ProviderService — ships in Slice 4",
      ).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new PlannerDriverError({
              reason: "not integrated with ProviderService yet — Slice 4",
            }),
          ),
        ),
      ),
  }),
);
