/**
 * PlannerDriver - Abstraction layer for WeavePlanner's LLM backend.
 *
 * Separates the planner loop (subscribe → compile → decode → persist) from
 * the concrete provider invocation so that tests can inject a stub without
 * standing up the full ProviderService stack.
 *
 * @module PlannerDriver
 */
import type { ProjectId, WeaveRunId } from "@t3tools/contracts";
import { Context, Data } from "effect";
import type { Effect } from "effect";

export class PlannerDriverError extends Data.TaggedError("PlannerDriverError")<{
  readonly reason: string;
}> {}

export interface PlannerDriverShape {
  /**
   * Invoke the planner and return raw JSON text for a Blueprint.
   *
   * @param input.weaveRunId             - ID of the Weave run being planned.
   * @param input.projectId              - Project the run belongs to.
   * @param input.parentThreadTitle      - Title for the synthetic planner thread.
   * @param input.projectWorkspaceRoot   - cwd for the provider session.
   * @param input.vision                 - The user's stated goal.
   * @param input.snapshotContent        - Serialized codebase snapshot (may be empty).
   * @param input.projectVerifierCommand - Project-level Weave verifier command default,
   *                                       passed to the planner as context for emitting
   *                                       per-node `verifierCommand` overrides.
   * @param input.previousError          - When retrying, the error from the previous attempt.
   */
  readonly compile: (input: {
    readonly weaveRunId: WeaveRunId;
    readonly projectId: ProjectId;
    readonly parentThreadTitle: string;
    readonly projectWorkspaceRoot: string;
    readonly vision: string;
    readonly snapshotContent: string;
    readonly projectVerifierCommand?: string;
    readonly previousError?: string;
  }) => Effect.Effect<string, PlannerDriverError>;
}

export class PlannerDriver extends Context.Service<PlannerDriver, PlannerDriverShape>()(
  "t3/orchestration/Services/PlannerDriver",
) {}
