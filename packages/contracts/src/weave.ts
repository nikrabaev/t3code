import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

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

// Scope — declared read-set and write-set for a Node.
// Glob patterns, v0.1 enforced only by worktree boundary.
export const Scope = Schema.Struct({
  readSet: Schema.Array(Schema.String),
  writeSet: Schema.Array(Schema.String),
});
export type Scope = typeof Scope.Type;

// WeaveContract — ancestor-authored interface for descendants to consume.
// `surface` and `semantics` are Markdown-with-types / Markdown respectively;
// allowed to be empty (a Contract may be all-semantics or all-surface).
export const WeaveContract = Schema.Struct({
  id: WeaveContractId,
  ownerNodeId: WeaveNodeId,
  surface: Schema.String,
  semantics: Schema.String,
  conformanceTestPath: Schema.optional(Schema.String),
});
export type WeaveContract = typeof WeaveContract.Type;

// WeavePhase — a demo-able slice of the Blueprint. Phases are linear.
export const WeavePhase = Schema.Struct({
  id: WeavePhaseId,
  ordinal: NonNegativeInt,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  smokeTestPath: Schema.optional(Schema.String),
  approval: WeavePhaseApproval,
});
export type WeavePhase = typeof WeavePhase.Type;

// WeaveDecision — a deferred choice with a blast radius.
export const WeaveDecisionResolution = Schema.Struct({
  answer: Schema.String,
  byUser: Schema.Boolean,
  rationale: Schema.optional(Schema.String),
  resolvedAt: IsoDateTime,
});
export type WeaveDecisionResolution = typeof WeaveDecisionResolution.Type;

export const WeaveDecision = Schema.Struct({
  id: WeaveDecisionId,
  question: TrimmedNonEmptyString,
  options: Schema.Array(Schema.String),
  blastRadiusNodeIds: Schema.Array(WeaveNodeId),
  preAuthScope: Schema.optional(DecisionPreAuthScope),
  resolution: Schema.optional(WeaveDecisionResolution),
});
export type WeaveDecision = typeof WeaveDecision.Type;
