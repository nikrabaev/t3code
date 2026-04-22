import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

// Branded IDs — mirror the `makeEntityId` pattern in baseSchemas.ts
// (trimmed non-empty strings with a nominal brand).
export const WeaveRunId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveRunId"));
export type WeaveRunId = typeof WeaveRunId.Type;

export const WeaveNodeId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveNodeId"));
export type WeaveNodeId = typeof WeaveNodeId.Type;

export const WeaveContractId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveContractId"));
export type WeaveContractId = typeof WeaveContractId.Type;

export const WeavePhaseId = TrimmedNonEmptyString.pipe(Schema.brand("WeavePhaseId"));
export type WeavePhaseId = typeof WeavePhaseId.Type;

export const WeaveDecisionId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveDecisionId"));
export type WeaveDecisionId = typeof WeaveDecisionId.Type;

// BlueprintVersion is a non-negative integer, branded for clarity at call sites.
export const BlueprintVersion = NonNegativeInt.pipe(Schema.brand("BlueprintVersion"));
export type BlueprintVersion = typeof BlueprintVersion.Type;

// Enums — literal unions for status and taxonomy values.
export const WeaveRunStatus = Schema.Literals([
  "draft",      // created, blueprint not yet compiled
  "reviewing",  // blueprint compiled, awaiting approval
  "running",    // approved, scheduler walking the DAG
  "paused",     // user paused OR replan in progress
  "complete",   // final phase approved
  "aborted",    // user exit before complete
]);
export type WeaveRunStatus = typeof WeaveRunStatus.Type;

export const WeaveNodeStatus = Schema.Literals([
  "pending",    // ancestors not ready
  "ready",      // schedulable
  "running",    // child thread active
  "verified",   // verifier green
  "failed",     // verifier red, ladder exhausted
  "paused",     // intervene or global replan
]);
export type WeaveNodeStatus = typeof WeaveNodeStatus.Type;

export const WeaveNodeKind = Schema.Literals([
  "raw",        // feature implementation (default)
  "scaffold",   // project structure, tooling
  "contract",   // interface-authoring
  "utility",    // shared helper / migration / fixture
]);
export type WeaveNodeKind = typeof WeaveNodeKind.Type;

export const WeavePhaseApproval = Schema.Literals([
  "pending",
  "approved",
  "rejected",
]);
export type WeavePhaseApproval = typeof WeavePhaseApproval.Type;

export const DecisionPreAuthScope = Schema.Literals([
  "library",    // tooling / package choices
  "naming",     // identifiers, conventions
  "copy",       // user-facing text
  "auth",       // authentication / authorization
  "data",       // schema decisions, storage shape
  "cost",       // billing-adjacent
]);
export type DecisionPreAuthScope = typeof DecisionPreAuthScope.Type;
