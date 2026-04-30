import { Schema } from "effect";
import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

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
  "draft", // created, blueprint not yet compiled
  "reviewing", // blueprint compiled, awaiting approval
  "running", // approved, scheduler walking the DAG
  "paused", // user paused OR replan in progress
  "complete", // final phase approved
  "aborted", // user exit before complete
]);
export type WeaveRunStatus = typeof WeaveRunStatus.Type;

export const WeaveNodeStatus = Schema.Literals([
  "pending", // ancestors not ready
  "ready", // schedulable (ancestors verified, decisions resolved)
  "running", // child thread active
  "verified", // verifier green
  "failed", // verifier red, ladder exhausted
  "paused", // intervene or global replan
]);
export type WeaveNodeStatus = typeof WeaveNodeStatus.Type;

export const WeaveNodeKind = Schema.Literals([
  "raw", // feature implementation (default)
  "scaffold", // project structure, tooling
  "contract", // interface-authoring
  "utility", // shared helper / migration / fixture
  "planning", // emits a Blueprint extension (sub-DAG); not code
]);
export type WeaveNodeKind = typeof WeaveNodeKind.Type;

export const WeavePhaseApproval = Schema.Literals([
  "pending", // phase not yet complete
  "approved",
  "rejected",
]);
export type WeavePhaseApproval = typeof WeavePhaseApproval.Type;

export const DecisionPreAuthScope = Schema.Literals([
  "library", // tooling / package choices
  "naming", // identifiers, conventions
  "copy", // user-facing text
  "auth", // authentication / authorization
  "data", // schema decisions, storage shape
  "cost", // anything with billing implications
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

// WeaveNode — a unit of work. One Node = one child Thread in later slices.
// Optional fields (advisoryDeps, childThreadId, worktreePath, failureNote)
// are absent until dispatched or resolved.
export const WeaveNode = Schema.Struct({
  id: WeaveNodeId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  kind: WeaveNodeKind,
  phaseId: WeavePhaseId,
  scope: Scope,
  inputContractIds: Schema.Array(WeaveContractId),
  outputContractIds: Schema.Array(WeaveContractId),
  verifierDescription: Schema.String,
  // Optional per-node verifier command override. When set, the runtime
  // executes this exact command (whitespace-split into argv) in the node's
  // worktree instead of the project default. Use it for nodes whose verifier
  // is not the project's standard test runner — e.g. a docs node may verify
  // with `mkdocs build`, a contract node with `bun typecheck`.
  verifierCommand: Schema.optional(TrimmedNonEmptyString),
  dependsOn: Schema.Array(WeaveNodeId),
  advisoryDeps: Schema.optional(Schema.Array(WeaveNodeId)),
  status: WeaveNodeStatus,
  childThreadId: Schema.optional(ThreadId),
  worktreePath: Schema.optional(Schema.String),
  failureNote: Schema.optional(Schema.String),
});
export type WeaveNode = typeof WeaveNode.Type;

// Blueprint — the compiled DAG. The only globally shared state in Weave mode.
// Versioned; every recompile (initial, amendment, redesign) yields a new version.
export const BlueprintSource = Schema.Literals([
  "planner",
  "amendment",
  "redesign",
  // Slice 3: tags Blueprint versions produced by a Planning Node's emission
  // (see WeaveBlueprintCompileReason).
  "phase-planning",
]);
export type BlueprintSource = typeof BlueprintSource.Type;

export const Blueprint = Schema.Struct({
  version: BlueprintVersion,
  nodes: Schema.Array(WeaveNode),
  phases: Schema.Array(WeavePhase),
  contracts: Schema.Array(WeaveContract),
  decisions: Schema.Array(WeaveDecision),
  compiledAt: IsoDateTime,
  compiledBy: BlueprintSource,
});
export type Blueprint = typeof Blueprint.Type;

// WeaveRun — the parent aggregate. Has 0..1 currentBlueprint (Blueprint itself
// lives in a separate projection row in Slice 3; the version number is enough here).
// concurrencyCap is bounded 1..8 per spec §1.5.
const ConcurrencyCap = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(8),
);

export const WeaveRun = Schema.Struct({
  id: WeaveRunId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  vision: Schema.String,
  parentThreadId: Schema.optional(ThreadId),
  parentMessageId: Schema.optional(MessageId),
  snapshotContent: Schema.optional(Schema.String),
  currentBlueprintVersion: Schema.optional(BlueprintVersion),
  status: WeaveRunStatus,
  currentPhaseId: Schema.optional(WeavePhaseId),
  concurrencyCap: ConcurrencyCap,
  // Recursion guard for incremental planning. Counts: meta-plan = depth 0;
  // a Phase Planning Node it emits = depth 1; etc. A Planning Node at depth
  // `cap` may not emit further Planning Nodes. Default applied at construction:
  // 3. Optional in the schema so existing fixtures keep decoding.
  planningDepthCap: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type WeaveRun = typeof WeaveRun.Type;

// --- Dispatchable (client-facing) Weave commands ---
// These are user-initiated and travel through
// OrchestrationRpcSchemas.dispatchCommand. They must be listed in
// DispatchableClientOrchestrationCommand (see orchestration.ts extensions).

export const WeaveCreateCommand = Schema.Struct({
  type: Schema.Literal("weave.create"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  vision: Schema.String,
  parentThreadId: Schema.optional(ThreadId),
  parentMessageId: Schema.optional(MessageId),
  snapshotContent: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});
export type WeaveCreateCommand = typeof WeaveCreateCommand.Type;

export const WeaveBlueprintApproveCommand = Schema.Struct({
  type: Schema.Literal("weave.blueprint.approve"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  blueprintVersion: BlueprintVersion,
  concurrencyCap: ConcurrencyCap,
  createdAt: IsoDateTime,
});
export type WeaveBlueprintApproveCommand = typeof WeaveBlueprintApproveCommand.Type;

export const WeavePhaseApproveCommand = Schema.Struct({
  type: Schema.Literal("weave.phase.approve"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  phaseId: WeavePhaseId,
  approval: WeavePhaseApproval,
  createdAt: IsoDateTime,
});
export type WeavePhaseApproveCommand = typeof WeavePhaseApproveCommand.Type;

export const WeaveDecisionResolveCommand = Schema.Struct({
  type: Schema.Literal("weave.decision.resolve"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  decisionId: WeaveDecisionId,
  answer: Schema.String,
  byUser: Schema.Boolean,
  rationale: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});
export type WeaveDecisionResolveCommand = typeof WeaveDecisionResolveCommand.Type;

export const WeaveExitReason = Schema.Literals(["complete", "aborted"]);
export type WeaveExitReason = typeof WeaveExitReason.Type;

export const WeaveExitCommand = Schema.Struct({
  type: Schema.Literal("weave.exit"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  reason: WeaveExitReason,
  createdAt: IsoDateTime,
});

export const WeaveDeleteCommand = Schema.Struct({
  type: Schema.Literal("weave.delete"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  createdAt: IsoDateTime,
});
export type WeaveDeleteCommand = typeof WeaveDeleteCommand.Type;

// Re-runs the verifier for a failed node without re-dispatching the agent.
// The existing child thread + worktree are reused; only the verifier runs
// again (status flips back to "running" while the verifier executes).
export const WeaveNodeRetryCommand = Schema.Struct({
  type: Schema.Literal("weave.node.retry"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  createdAt: IsoDateTime,
});
export type WeaveNodeRetryCommand = typeof WeaveNodeRetryCommand.Type;
export type WeaveExitCommand = typeof WeaveExitCommand.Type;

// Re-dispatches the agent for a failed node by sending a fresh turn-start to
// the existing child thread (the worktree + thread are reused). The verifier
// runs automatically once the new turn quiesces.
export const WeaveNodeRestartCommand = Schema.Struct({
  type: Schema.Literal("weave.node.restart"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  createdAt: IsoDateTime,
});
export type WeaveNodeRestartCommand = typeof WeaveNodeRestartCommand.Type;

export const WeaveDispatchableCommand = Schema.Union([
  WeaveCreateCommand,
  WeaveBlueprintApproveCommand,
  WeavePhaseApproveCommand,
  WeaveDecisionResolveCommand,
  WeaveExitCommand,
  WeaveDeleteCommand,
  WeaveNodeRetryCommand,
  WeaveNodeRestartCommand,
]);
export type WeaveDispatchableCommand = typeof WeaveDispatchableCommand.Type;

// --- Internal (server-only) Weave commands ---
// Emitted by WeavePlanner, WeaveScheduler, WeaveContractConformer reactors
// in Slice 3. Must not be accepted from the client.

export const WeaveBlueprintCompileReason = Schema.Literals([
  "initial",
  "amendment",
  "redesign",
  "phase-planning",
]);
export type WeaveBlueprintCompileReason = typeof WeaveBlueprintCompileReason.Type;

export const WeaveBlueprintCompileCommand = Schema.Struct({
  type: Schema.Literal("weave.blueprint.compile"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  reason: WeaveBlueprintCompileReason,
  createdAt: IsoDateTime,
});
export type WeaveBlueprintCompileCommand = typeof WeaveBlueprintCompileCommand.Type;

export const WeaveNodeDispatchCommand = Schema.Struct({
  type: Schema.Literal("weave.node.dispatch"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  childThreadId: ThreadId,
  worktreePath: Schema.String,
  createdAt: IsoDateTime,
});
export type WeaveNodeDispatchCommand = typeof WeaveNodeDispatchCommand.Type;

export const WeaveNodeVerifiedCommand = Schema.Struct({
  type: Schema.Literal("weave.node.verified"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  verifierOutcome: Schema.String,
  createdAt: IsoDateTime,
});
export type WeaveNodeVerifiedCommand = typeof WeaveNodeVerifiedCommand.Type;

export const WeaveNodeFailedCommand = Schema.Struct({
  type: Schema.Literal("weave.node.failed"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  reason: Schema.String,
  // Captured stdout+stderr from the verifier process (or any caller's chosen
  // detail), used by the inspector to surface the full failure context. May
  // be truncated by the producer; the prefix `[truncated]\n` is conventional.
  failureOutput: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});
export type WeaveNodeFailedCommand = typeof WeaveNodeFailedCommand.Type;

// Internal command emitted when a Planning Node's dispatch produces a valid
// sub-DAG. Causes the decider to bump BlueprintVersion and append the listed
// Nodes under the planner. Server-only; not accepted from the client.
export const WeaveBlueprintExtendCommand = Schema.Struct({
  type: Schema.Literal("weave.blueprint.extend"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  plannerNodeId: WeaveNodeId,
  // The full content of the nodes to append. The decider extracts the IDs
  // for the corresponding `WeaveBlueprintExtendedPayload.addedNodeIds`.
  addedNodes: Schema.Array(WeaveNode),
  createdAt: IsoDateTime,
});
export type WeaveBlueprintExtendCommand = typeof WeaveBlueprintExtendCommand.Type;

// PhasePlannerOutput — the JSON shape a Phase Planner agent emits when it
// finishes running. The conformer parses the agent's accumulated assistant
// text against this schema. On success, the conformer dispatches
// `weave.blueprint.extend` with the same addedNodes; on failure (parse error
// or schema mismatch), it dispatches `weave.node.failed`.
//
// Slice 3 simplification: addedNodes must NOT include any node with
// kind: "planning". Recursion (mid-Phase Planning Nodes that emit further
// sub-DAGs) requires depth tracking on WeaveNode and is deferred to a
// later slice. The decider for weave.blueprint.extend enforces this; the
// schema itself does not, because Schema-level enforcement would require
// a refinement that is awkward to compose with `Schema.Array(WeaveNode)`.
export const PhasePlannerOutput = Schema.Struct({
  addedNodes: Schema.Array(WeaveNode),
});
export type PhasePlannerOutput = typeof PhasePlannerOutput.Type;

export const WeaveInternalCommand = Schema.Union([
  WeaveBlueprintCompileCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeVerifiedCommand,
  WeaveNodeFailedCommand,
  WeaveBlueprintExtendCommand,
]);
export type WeaveInternalCommand = typeof WeaveInternalCommand.Type;

// Convenience: a union of every Weave command. Slice 2's decider takes this as input.
export const WeaveCommand = Schema.Union([WeaveDispatchableCommand, WeaveInternalCommand]);
export type WeaveCommand = typeof WeaveCommand.Type;

// --- Weave event payloads ---
// These are payload-only structs; the surrounding event envelope
// (sequence, eventId, aggregateKind="weave", aggregateId=WeaveRunId, ...)
// is added inside the OrchestrationEvent union in orchestration.ts.
//
// Every payload carries `weaveRunId` + `occurredAt` for self-identification
// even without the envelope — matches how ThreadCreatedPayload carries threadId.

export const WeaveCreatedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  vision: Schema.String,
  parentThreadId: Schema.optional(ThreadId),
  parentMessageId: Schema.optional(MessageId),
  snapshotContent: Schema.optional(Schema.String),
  occurredAt: IsoDateTime,
});
export type WeaveCreatedPayload = typeof WeaveCreatedPayload.Type;

export const WeaveBlueprintCompiledPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  version: BlueprintVersion,
  blueprint: Blueprint,
  compiledBy: BlueprintSource,
  occurredAt: IsoDateTime,
});
export type WeaveBlueprintCompiledPayload = typeof WeaveBlueprintCompiledPayload.Type;

// Emitted when a Planning Node's dispatch produces a sub-DAG appended under
// itself. Carries the new BlueprintVersion plus the ids of the freshly added
// Nodes so projections can incrementally apply the delta. The full new
// Blueprint is always also emitted as a sibling weave.blueprint-compiled
// (reason: "phase-planning") so projections never reconstruct from deltas
// alone.
export const WeaveBlueprintExtendedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  version: BlueprintVersion,
  plannerNodeId: WeaveNodeId,
  addedNodeIds: Schema.Array(WeaveNodeId),
  occurredAt: IsoDateTime,
});
export type WeaveBlueprintExtendedPayload = typeof WeaveBlueprintExtendedPayload.Type;

export const WeaveBlueprintApprovedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  version: BlueprintVersion,
  concurrencyCap: ConcurrencyCap,
  occurredAt: IsoDateTime,
});
export type WeaveBlueprintApprovedPayload = typeof WeaveBlueprintApprovedPayload.Type;

export const WeaveNodeDispatchedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  childThreadId: ThreadId,
  worktreePath: Schema.String,
  occurredAt: IsoDateTime,
});
export type WeaveNodeDispatchedPayload = typeof WeaveNodeDispatchedPayload.Type;

export const WeaveNodeVerifiedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  verifierOutcome: Schema.String,
  occurredAt: IsoDateTime,
});
export type WeaveNodeVerifiedPayload = typeof WeaveNodeVerifiedPayload.Type;

export const WeaveNodeFailedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  reason: Schema.String,
  failureOutput: Schema.optional(Schema.String),
  occurredAt: IsoDateTime,
});
export type WeaveNodeFailedPayload = typeof WeaveNodeFailedPayload.Type;

export const WeaveNodeRetryRequestedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  occurredAt: IsoDateTime,
});
export type WeaveNodeRetryRequestedPayload = typeof WeaveNodeRetryRequestedPayload.Type;

export const WeaveNodeRestartRequestedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  nodeId: WeaveNodeId,
  occurredAt: IsoDateTime,
});
export type WeaveNodeRestartRequestedPayload = typeof WeaveNodeRestartRequestedPayload.Type;

export const WeaveDecisionResolvedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  decisionId: WeaveDecisionId,
  answer: Schema.String,
  byUser: Schema.Boolean,
  rationale: Schema.optional(Schema.String),
  occurredAt: IsoDateTime,
});
export type WeaveDecisionResolvedPayload = typeof WeaveDecisionResolvedPayload.Type;

export const WeavePhaseApprovedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  phaseId: WeavePhaseId,
  approval: WeavePhaseApproval,
  occurredAt: IsoDateTime,
});
export type WeavePhaseApprovedPayload = typeof WeavePhaseApprovedPayload.Type;

export const WeaveExitedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  reason: WeaveExitReason,
  occurredAt: IsoDateTime,
});
export type WeaveExitedPayload = typeof WeaveExitedPayload.Type;

export const WeaveDeletedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  occurredAt: IsoDateTime,
});
export type WeaveDeletedPayload = typeof WeaveDeletedPayload.Type;

export const WeavePlannerThreadCreatedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
});
export type WeavePlannerThreadCreatedPayload = typeof WeavePlannerThreadCreatedPayload.Type;

// --- WeaveNodeMeta ---
// Per-node runtime metadata surfaced in the projection. Extends status with
// timestamps and failure reason so the UI can render per-node detail without
// re-querying the event log.
export const WeaveNodeMeta = Schema.Struct({
  status: WeaveNodeStatus,
  dispatchedAt: Schema.optional(IsoDateTime),
  verifiedAt: Schema.optional(IsoDateTime),
  failedAt: Schema.optional(IsoDateTime),
  failureReason: Schema.optional(Schema.String),
  // Verifier process output (stdout+stderr, possibly truncated). Set when the
  // verifier failure includes a captured process output; absent for manual
  // failures or when the runtime did not produce output.
  failureOutput: Schema.optional(Schema.String),
});
export type WeaveNodeMeta = typeof WeaveNodeMeta.Type;

// --- WeaveRunProjection ---
// The accumulated read-model state for one WeaveRun. Promoted to contracts in
// Slice 3 Task 3 so OrchestrationReadModel.weaveRuns can reference the schema.
//
// Map/Set fields use Schema.ReadonlyMap / Schema.ReadonlySet (available in
// Effect 4 beta ≥4.0.0-beta.45). Both serialize as arrays for JSON roundtrip:
//   ReadonlyMap → ReadonlyArray<readonly [Key, Value]>
//   ReadonlySet  → ReadonlyArray<Value>
export const WeaveRunProjectionSchema = Schema.Struct({
  run: WeaveRun,
  currentBlueprint: Schema.NullOr(Blueprint),
  // ReadonlyMap<WeaveNodeId, WeaveNodeMeta>
  nodeMeta: Schema.ReadonlyMap(WeaveNodeId, WeaveNodeMeta),
  // ReadonlySet<WeaveDecisionId>
  openDecisions: Schema.ReadonlySet(WeaveDecisionId),
  autoDecisionLog: Schema.Array(
    Schema.Struct({
      decisionId: WeaveDecisionId,
      answer: Schema.String,
      at: IsoDateTime,
    }),
  ),
  // ReadonlyMap<WeavePhaseId, WeavePhaseApproval>
  phaseApprovals: Schema.ReadonlyMap(WeavePhaseId, WeavePhaseApproval),
  // ReadonlyMap<WeaveNodeId, { threadId: ThreadId; worktreePath: string }>
  childThreads: Schema.ReadonlyMap(
    WeaveNodeId,
    Schema.Struct({
      threadId: ThreadId,
      worktreePath: Schema.String,
    }),
  ),
});
export type WeaveRunProjection = typeof WeaveRunProjectionSchema.Type;
