/**
 * PlannerDriverPlaceholderLive — placeholder used in non-server contexts
 * (CLI read model queries, integration tests that inject their own stub).
 *
 * Every compile() call fails immediately. In the CLI context the WeavePlanner
 * is never started so this layer is never exercised. The real implementation
 * lives in PlannerDriver.ts and is wired in by server.ts.
 *
 * @module PlannerDriverPlaceholderLive
 */
import { Effect, Layer } from "effect";

import { PlannerDriver, PlannerDriverError } from "../Services/PlannerDriver.ts";

export const PlannerDriverPlaceholderLive = Layer.succeed(
  PlannerDriver,
  PlannerDriver.of({
    compile: (_input) =>
      Effect.logWarning(
        "PlannerDriverPlaceholderLive: not integrated with ProviderService in this context",
      ).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new PlannerDriverError({
              reason: "PlannerDriver placeholder — not available outside the full server runtime",
            }),
          ),
        ),
      ),
  }),
);
