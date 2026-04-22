# Weave v0.1 — Slice 1 (Contracts Extension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Effect Schema definitions for the Weave Run aggregate (Blueprint, Node, Contract, Phase, Decision, commands, events) to `@t3tools/contracts`, and extend `ProviderInteractionMode` / `OrchestrationAggregateKind` / `OrchestrationEvent` / `OrchestrationCommand` unions so Weave rides the existing orchestration push channel.

**Architecture:** Schema-only extension to `packages/contracts`. A new `weave.ts` module holds all Weave-specific schemas; `orchestration.ts` grows three union variants (aggregate kind, event types, command types). Follows existing t3code conventions: `type`-discriminated variants, `TrimmedNonEmptyString`-branded IDs via `makeEntityId`, `EventBaseFields` for every event, `@effect/vitest` for tests. Deliverable is purely types — no runtime code, no reactors, no RPC handlers. Later slices (2–4) consume this contract.

**Tech Stack:** TypeScript, Effect 4 beta (`effect` catalog dep), Effect Schema, `@effect/vitest` (`it.effect` pattern). Build tool: `tsdown`. Test runner: `vitest` via `bun run test`. Package manager: `bun`. Lint/format: `oxlint` / `oxfmt`.

---

## Context: deviations from the spec text

[docs/v0.1-spec.md](../../../../docs/v0.1-spec.md) §Slice 1 is written as an aspirational sketch. The actual `packages/contracts/src/orchestration.ts` already has established conventions that the sketch does not match. **This plan follows the codebase conventions, not the sketch verbatim.** The spec's §1.8 explicitly authorizes this (*"Inspect the actual current shape of `OrchestrationDomainEvent` in `orchestration.ts` / `ws.ts` before merging"*). Specific deltas:

| Spec sketch | Codebase convention we follow |
|---|---|
| `export const WeaveRunId = Schema.String.pipe(Schema.brand("WeaveRunId"))` | `makeEntityId("WeaveRunId")` in [`baseSchemas.ts`](../../../../packages/contracts/src/baseSchemas.ts) — trimmed non-empty string |
| `const Cmd = <K, P>(kind: K, payload: P) => Schema.Struct({ kind: Schema.Literal(kind), commandId: Schema.String, ...payload })` | Explicit `Schema.Struct({ type: Schema.Literal("..."), commandId: CommandId, ..., createdAt: IsoDateTime })` — matches `ThreadCreateCommand` etc. |
| `const Evt = <K, P>(kind, payload) => Schema.Struct({ type, aggregate, weaveRunId, occurredAt, ...payload })` | Payload-only structs (e.g. `WeaveCreatedPayload`); wrapped with `EventBaseFields` in the `OrchestrationEvent` union — matches `ThreadCreatedPayload` etc. |
| `OrchestrationDomainEvent = Schema.Union(ThreadDomainEvent, WeaveDomainEvent)` | No `ThreadDomainEvent` exists. Extend `OrchestrationEvent` (the real master union), `OrchestrationAggregateKind`, `OrchestrationEventType`, and the `aggregateId` union. |
| `aggregate: "thread" \| "weave"` discriminant | `aggregateKind: "project" \| "thread"` (extend with `"weave"`); `aggregateId` is `Schema.Union([ProjectId, ThreadId])` (extend with `WeaveRunId`). |
| Free-form `Schema.String` timestamps | `IsoDateTime` from `baseSchemas.ts` |
| Free-form `Schema.String` text fields | `TrimmedNonEmptyString` where non-empty is meaningful (title, question, etc.); `Schema.String` for multi-line content (Markdown descriptions, semantics, surface) |
| Spec's `projectId: Schema.String` on `WeaveRun` / `WeaveCreateCommand` / `WeaveCreatedPayload` | **Branded `ProjectId` from `baseSchemas.ts`.** All branded IDs live there (not in `orchestration.ts`), so there is no import-cycle risk; `weave.ts` and `orchestration.ts` both import from `baseSchemas.ts` as peers. |
| Spec's `parentThreadId` / `parentMessageId` / `childThreadId` as `Schema.optional(Schema.String)` | **Branded `Schema.optional(ThreadId)` / `Schema.optional(MessageId)`**, same rationale. These fields *are* t3code thread/message IDs — weakening them loses type safety across the seam. `WeaveNodeDispatchCommand.childThreadId` is non-optional `ThreadId` (set at dispatch time). |

The spec's **field names, struct names, enum values, command/event names** are all kept verbatim. Only the **surrounding plumbing** is adjusted to match existing codebase discipline.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/contracts/src/weave.ts` | **NEW** | All Weave-specific branded IDs, enums, structs, commands, event payloads, and `WeaveCommand` / `WeaveEventPayload` unions. No runtime code. |
| `packages/contracts/src/orchestration.ts` | Modify | Extend `ProviderInteractionMode`, `OrchestrationAggregateKind`, `OrchestrationEventType`, the `aggregateId` union inside `EventBaseFields`, the `DispatchableClientOrchestrationCommand` / `InternalOrchestrationCommand` / `OrchestrationCommand` unions, and the `OrchestrationEvent` union. Import weave schemas from `./weave.ts`. |
| `packages/contracts/src/index.ts` | Modify | `export * from "./weave.ts"` — one line. |
| `packages/contracts/src/weave.test.ts` | **NEW** | Round-trip encode/decode tests for every Weave schema; default-value tests; cross-variant decode tests via `OrchestrationCommand` / `OrchestrationEvent`. |
| `packages/contracts/src/orchestration.test.ts` | Modify | Two new `it.effect` cases: (1) `ProviderInteractionMode` accepts `"weave"`; (2) `OrchestrationEvent` decodes a weave variant with `aggregateKind: "weave"`. |

**No other files change.** Nothing in `apps/server`, `apps/web`, `packages/shared`, or anywhere else. Schema-only by t3code convention ([AGENTS.md line 31](../../../../AGENTS.md)).

---

## Task 1: Extend `ProviderInteractionMode` with `"weave"`

**Files:**
- Modify: `packages/contracts/src/orchestration.ts:93`
- Modify: `packages/contracts/src/orchestration.test.ts`

- [ ] **Step 1.1: Write the failing test**

Add to `packages/contracts/src/orchestration.test.ts` near the other `ProviderInteractionMode` usages:

```ts
import { ProviderInteractionMode } from "./orchestration.ts";

// ... with the other decodeXxx helpers:
const decodeProviderInteractionMode = Schema.decodeUnknownEffect(ProviderInteractionMode);

it.effect("accepts 'weave' as a provider interaction mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProviderInteractionMode("weave");
    assert.strictEqual(parsed, "weave");
  }),
);
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: FAIL on the new case. Effect Schema rejects `"weave"` because the literal union only contains `"default"` and `"plan"`.

- [ ] **Step 1.3: Implement the minimal change**

Edit `packages/contracts/src/orchestration.ts:93`:

```ts
// Before:
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
// After:
export const ProviderInteractionMode = Schema.Literals(["default", "plan", "weave"]);
```

No other lines change. The `type ProviderInteractionMode = typeof ProviderInteractionMode.Type` on the next line automatically widens.

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: PASS. All prior `ProviderInteractionMode` tests still pass (widening is backwards-compatible).

- [ ] **Step 1.5: Commit**

```bash
git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(contracts): add 'weave' to ProviderInteractionMode literal union"
```

---

## Task 2: Create `weave.ts` with branded IDs and index export

**Files:**
- Create: `packages/contracts/src/weave.ts`
- Create: `packages/contracts/src/weave.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 2.1: Write the failing test**

Create `packages/contracts/src/weave.test.ts`:

```ts
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BlueprintVersion,
  WeaveContractId,
  WeaveDecisionId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "./weave.ts";

const decodeWeaveRunId = Schema.decodeUnknownEffect(WeaveRunId);
const decodeWeaveNodeId = Schema.decodeUnknownEffect(WeaveNodeId);
const decodeWeaveContractId = Schema.decodeUnknownEffect(WeaveContractId);
const decodeWeavePhaseId = Schema.decodeUnknownEffect(WeavePhaseId);
const decodeWeaveDecisionId = Schema.decodeUnknownEffect(WeaveDecisionId);
const decodeBlueprintVersion = Schema.decodeUnknownEffect(BlueprintVersion);

it.effect("trims and brands WeaveRunId", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRunId("  run-1  ");
    assert.strictEqual(parsed, "run-1");
  }),
);

it.effect("rejects empty WeaveRunId after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeWeaveRunId("   "));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts a non-negative integer BlueprintVersion", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBlueprintVersion(1);
    assert.strictEqual(parsed, 1);
  }),
);

it.effect("brands the other weave ids", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* decodeWeaveNodeId("node-1"), "node-1");
    assert.strictEqual(yield* decodeWeaveContractId("contract-1"), "contract-1");
    assert.strictEqual(yield* decodeWeavePhaseId("phase-1"), "phase-1");
    assert.strictEqual(yield* decodeWeaveDecisionId("decision-1"), "decision-1");
  }),
);
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL — `weave.ts` does not exist.

- [ ] **Step 2.3: Create `weave.ts` with branded IDs**

Create `packages/contracts/src/weave.ts`:

```ts
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
```

- [ ] **Step 2.4: Add the `weave.ts` export to the package barrel**

Edit `packages/contracts/src/index.ts` — add a line alongside the other `export * from` statements:

```ts
export * from "./weave.ts";
```

Place it after `export * from "./orchestration.ts";` to keep ordering stable (new module at the end of the orchestration-adjacent group).

- [ ] **Step 2.5: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS (all four `it.effect` cases).

- [ ] **Step 2.6: Typecheck to verify the barrel export works**

Run: `cd packages/contracts && bun typecheck`

Expected: clean (no errors).

- [ ] **Step 2.7: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add weave branded ids (WeaveRunId, WeaveNodeId, …)"
```

---

## Task 3: Add Weave enums

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import {
  DecisionPreAuthScope,
  WeaveNodeKind,
  WeaveNodeStatus,
  WeavePhaseApproval,
  WeaveRunStatus,
} from "./weave.ts";

const decodeWeaveRunStatus = Schema.decodeUnknownEffect(WeaveRunStatus);
const decodeWeaveNodeStatus = Schema.decodeUnknownEffect(WeaveNodeStatus);
const decodeWeaveNodeKind = Schema.decodeUnknownEffect(WeaveNodeKind);
const decodeWeavePhaseApproval = Schema.decodeUnknownEffect(WeavePhaseApproval);
const decodeDecisionPreAuthScope = Schema.decodeUnknownEffect(DecisionPreAuthScope);

it.effect("accepts every WeaveRunStatus literal", () =>
  Effect.gen(function* () {
    for (const s of ["draft", "reviewing", "running", "paused", "complete", "aborted"] as const) {
      assert.strictEqual(yield* decodeWeaveRunStatus(s), s);
    }
  }),
);

it.effect("rejects unknown WeaveRunStatus", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeWeaveRunStatus("nope"));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts every WeaveNodeStatus literal", () =>
  Effect.gen(function* () {
    for (const s of ["pending", "ready", "running", "verified", "failed", "paused"] as const) {
      assert.strictEqual(yield* decodeWeaveNodeStatus(s), s);
    }
  }),
);

it.effect("accepts every WeaveNodeKind literal", () =>
  Effect.gen(function* () {
    for (const k of ["raw", "scaffold", "contract", "utility"] as const) {
      assert.strictEqual(yield* decodeWeaveNodeKind(k), k);
    }
  }),
);

it.effect("accepts every WeavePhaseApproval literal", () =>
  Effect.gen(function* () {
    for (const a of ["pending", "approved", "rejected"] as const) {
      assert.strictEqual(yield* decodeWeavePhaseApproval(a), a);
    }
  }),
);

it.effect("accepts every DecisionPreAuthScope literal", () =>
  Effect.gen(function* () {
    for (const s of ["library", "naming", "copy", "auth", "data", "cost"] as const) {
      assert.strictEqual(yield* decodeDecisionPreAuthScope(s), s);
    }
  }),
);
```

- [ ] **Step 3.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL — the enums don't exist yet.

- [ ] **Step 3.3: Implement the enums**

Append to `packages/contracts/src/weave.ts` (after the branded IDs):

```ts
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
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add weave enums (RunStatus, NodeStatus, NodeKind, PhaseApproval, PreAuthScope)"
```

---

## Task 4: Add leaf struct schemas (Scope, WeaveContract, WeavePhase, WeaveDecision)

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

These four structs have no forward references among themselves; they're leaves in the dependency DAG. Add them together, each with a round-trip test.

- [ ] **Step 4.1: Write the failing tests**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import {
  Scope,
  WeaveContract,
  WeaveDecision,
  WeavePhase,
} from "./weave.ts";

const decodeScope = Schema.decodeUnknownEffect(Scope);
const decodeWeaveContract = Schema.decodeUnknownEffect(WeaveContract);
const decodeWeavePhase = Schema.decodeUnknownEffect(WeavePhase);
const decodeWeaveDecision = Schema.decodeUnknownEffect(WeaveDecision);

it.effect("round-trips a Scope with read/write globs", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeScope({
      readSet: ["src/**/*.ts"],
      writeSet: ["src/feature/**/*.ts"],
    });
    assert.deepStrictEqual(parsed.readSet, ["src/**/*.ts"]);
    assert.deepStrictEqual(parsed.writeSet, ["src/feature/**/*.ts"]);
  }),
);

it.effect("round-trips a WeaveContract without conformanceTestPath", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveContract({
      id: "contract-1",
      ownerNodeId: "node-1",
      surface: "type Foo = { bar: string }",
      semantics: "bar is never empty",
    });
    assert.strictEqual(parsed.id, "contract-1");
    assert.strictEqual(parsed.conformanceTestPath, undefined);
  }),
);

it.effect("round-trips a WeaveContract with conformanceTestPath", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveContract({
      id: "contract-2",
      ownerNodeId: "node-2",
      surface: "{}",
      semantics: "",
      conformanceTestPath: ".weave/contracts/node-2/conformance.test.ts",
    });
    assert.strictEqual(
      parsed.conformanceTestPath,
      ".weave/contracts/node-2/conformance.test.ts",
    );
  }),
);

it.effect("round-trips a WeavePhase with default approval pending", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePhase({
      id: "phase-1",
      ordinal: 0,
      title: "Scaffold",
      description: "Lay down tooling and package layout.",
      approval: "pending",
    });
    assert.strictEqual(parsed.ordinal, 0);
    assert.strictEqual(parsed.approval, "pending");
  }),
);

it.effect("round-trips a WeaveDecision without a resolution", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecision({
      id: "decision-1",
      question: "Pick a state library.",
      options: ["zustand", "jotai", "valtio"],
      blastRadiusNodeIds: ["node-a", "node-b"],
    });
    assert.strictEqual(parsed.resolution, undefined);
    assert.deepStrictEqual(parsed.options, ["zustand", "jotai", "valtio"]);
  }),
);

it.effect("round-trips a WeaveDecision with a user-supplied resolution", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecision({
      id: "decision-2",
      question: "Pick a state library.",
      options: ["zustand", "jotai"],
      blastRadiusNodeIds: [],
      preAuthScope: "library",
      resolution: {
        answer: "jotai",
        byUser: true,
        rationale: "Already in the codebase.",
        resolvedAt: "2026-04-21T12:00:00.000Z",
      },
    });
    assert.strictEqual(parsed.resolution?.answer, "jotai");
    assert.strictEqual(parsed.resolution?.byUser, true);
    assert.strictEqual(parsed.preAuthScope, "library");
  }),
);
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL — these structs don't exist.

- [ ] **Step 4.3: Implement the structs**

Append to `packages/contracts/src/weave.ts`:

```ts
import { IsoDateTime } from "./baseSchemas.ts";

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
```

Note: `WeaveDecisionResolution` is extracted as a named schema (unlike the spec's inline struct) so Slice 2's decider can reference it.

- [ ] **Step 4.4: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add Scope, WeaveContract, WeavePhase, WeaveDecision structs"
```

---

## Task 5: Add `WeaveNode` struct

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

- [ ] **Step 5.1: Write the failing test**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { WeaveNode } from "./weave.ts";

const decodeWeaveNode = Schema.decodeUnknownEffect(WeaveNode);

it.effect("round-trips a minimal pending WeaveNode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNode({
      id: "node-1",
      title: "Scaffold server package",
      description: "Create apps/server skeleton.",
      kind: "scaffold",
      phaseId: "phase-1",
      scope: { readSet: ["**/*.ts"], writeSet: ["apps/server/src/**"] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "Typecheck passes.",
      dependsOn: [],
      status: "pending",
    });
    assert.strictEqual(parsed.kind, "scaffold");
    assert.strictEqual(parsed.status, "pending");
    assert.strictEqual(parsed.advisoryDeps, undefined);
    assert.strictEqual(parsed.childThreadId, undefined);
    assert.strictEqual(parsed.worktreePath, undefined);
    assert.strictEqual(parsed.failureNote, undefined);
  }),
);

it.effect("round-trips a running WeaveNode with child-thread metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNode({
      id: "node-2",
      title: "Implement auth",
      description: "",
      kind: "raw",
      phaseId: "phase-2",
      scope: { readSet: [], writeSet: ["apps/server/src/auth/**"] },
      inputContractIds: ["contract-1"],
      outputContractIds: [],
      verifierDescription: "bun run test passes.",
      dependsOn: ["node-1"],
      advisoryDeps: ["node-0"],
      status: "running",
      childThreadId: "thread-abc",
      worktreePath: "/tmp/wt/node-2",
    });
    assert.deepStrictEqual(parsed.dependsOn, ["node-1"]);
    assert.deepStrictEqual(parsed.advisoryDeps, ["node-0"]);
    assert.strictEqual(parsed.childThreadId, "thread-abc");
    assert.strictEqual(parsed.worktreePath, "/tmp/wt/node-2");
  }),
);

it.effect("round-trips a failed WeaveNode with a failureNote", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNode({
      id: "node-3",
      title: "Broken",
      description: "",
      kind: "raw",
      phaseId: "phase-1",
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [],
      status: "failed",
      failureNote: "Contract amendment needed.",
    });
    assert.strictEqual(parsed.failureNote, "Contract amendment needed.");
  }),
);
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL.

- [ ] **Step 5.3: Implement the struct**

Extend the existing `baseSchemas.ts` import in `weave.ts` to include `ThreadId`:

```ts
import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
```

(Merge with the existing import introduced in Tasks 2 and 4. `CommandId`, `ProjectId`, `MessageId` will be added to this line in later tasks.)

Append to `packages/contracts/src/weave.ts`:

```ts
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
  dependsOn: Schema.Array(WeaveNodeId),
  advisoryDeps: Schema.optional(Schema.Array(WeaveNodeId)),
  status: WeaveNodeStatus,
  childThreadId: Schema.optional(ThreadId),
  worktreePath: Schema.optional(Schema.String),
  failureNote: Schema.optional(Schema.String),
});
export type WeaveNode = typeof WeaveNode.Type;
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add WeaveNode struct"
```

---

## Task 6: Add `Blueprint` struct

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

- [ ] **Step 6.1: Write the failing test**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { Blueprint } from "./weave.ts";

const decodeBlueprint = Schema.decodeUnknownEffect(Blueprint);

it.effect("round-trips a Blueprint with one phase, one node, zero contracts/decisions", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBlueprint({
      version: 1,
      nodes: [
        {
          id: "node-1",
          title: "Scaffold",
          description: "",
          kind: "scaffold",
          phaseId: "phase-1",
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        {
          id: "phase-1",
          ordinal: 0,
          title: "Foundations",
          description: "",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: "2026-04-21T00:00:00.000Z",
      compiledBy: "planner",
    });
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.nodes.length, 1);
    assert.strictEqual(parsed.phases.length, 1);
    assert.strictEqual(parsed.compiledBy, "planner");
  }),
);

it.effect("accepts every Blueprint.compiledBy literal", () =>
  Effect.gen(function* () {
    for (const source of ["planner", "amendment", "redesign"] as const) {
      const parsed = yield* decodeBlueprint({
        version: 2,
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: "2026-04-21T00:00:00.000Z",
        compiledBy: source,
      });
      assert.strictEqual(parsed.compiledBy, source);
    }
  }),
);

it.effect("rejects an unknown Blueprint.compiledBy", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeBlueprint({
        version: 1,
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: "2026-04-21T00:00:00.000Z",
        compiledBy: "user", // not in the literal set
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
```

Note on cross-field validity: [v0.1-spec.md §1.9](../../../../../docs/v0.1-spec.md) suggests a test asserting that a Node's `phaseId` not matching any `WeavePhase.id` fails — but also says "handled via invariant in Slice 2, but schema-level can check array membership via a refinement if easy." **We defer this to Slice 2's `weaveCommandInvariants.ts`**; it's cleaner as an invariant than a schema refinement, and Slice 1 stays schema-only.

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL.

- [ ] **Step 6.3: Implement the struct**

Append to `packages/contracts/src/weave.ts`:

```ts
// Blueprint — the compiled DAG. The only globally shared state in Weave mode.
// Versioned; every recompile (initial, amendment, redesign) yields a new version.
export const BlueprintSource = Schema.Literals(["planner", "amendment", "redesign"]);
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
```

`BlueprintSource` is extracted so Slice 2's decider and Slice 3's planner can reference it by name.

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add Blueprint struct and BlueprintSource enum"
```

---

## Task 7: Add `WeaveRun` struct

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

- [ ] **Step 7.1: Write the failing tests**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { WeaveRun } from "./weave.ts";

const decodeWeaveRun = Schema.decodeUnknownEffect(WeaveRun);

it.effect("round-trips a minimal draft WeaveRun", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-1",
      projectId: "project-1",
      title: "Add a blog",
      vision: "# Goal\nShip a blog.",
      status: "draft",
      concurrencyCap: 1,
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.id, "run-1");
    assert.strictEqual(parsed.status, "draft");
    assert.strictEqual(parsed.concurrencyCap, 1);
    assert.strictEqual(parsed.currentBlueprintVersion, undefined);
    assert.strictEqual(parsed.currentPhaseId, undefined);
    assert.strictEqual(parsed.parentThreadId, undefined);
    assert.strictEqual(parsed.parentMessageId, undefined);
    assert.strictEqual(parsed.snapshotContent, undefined);
  }),
);

it.effect("round-trips a running WeaveRun with parent-thread metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-2",
      projectId: "project-1",
      title: "Add a blog",
      vision: "# Goal\nShip a blog.",
      parentThreadId: "thread-parent",
      parentMessageId: "msg-123",
      snapshotContent: "# Parent chat\n…",
      currentBlueprintVersion: 1,
      status: "running",
      currentPhaseId: "phase-1",
      concurrencyCap: 1,
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.status, "running");
    assert.strictEqual(parsed.currentBlueprintVersion, 1);
    assert.strictEqual(parsed.currentPhaseId, "phase-1");
    assert.strictEqual(parsed.parentThreadId, "thread-parent");
  }),
);

it.effect("rejects concurrencyCap outside 1..8", () =>
  Effect.gen(function* () {
    const tooSmall = yield* Effect.exit(
      decodeWeaveRun({
        id: "run-3",
        projectId: "project-1",
        title: "X",
        vision: "",
        status: "draft",
        concurrencyCap: 0,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(tooSmall._tag, "Failure");

    const tooBig = yield* Effect.exit(
      decodeWeaveRun({
        id: "run-4",
        projectId: "project-1",
        title: "X",
        vision: "",
        status: "draft",
        concurrencyCap: 9,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(tooBig._tag, "Failure");

    const nonInt = yield* Effect.exit(
      decodeWeaveRun({
        id: "run-5",
        projectId: "project-1",
        title: "X",
        vision: "",
        status: "draft",
        concurrencyCap: 1.5,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(nonInt._tag, "Failure");
  }),
);
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL.

- [ ] **Step 7.3: Implement the struct**

Extend the `baseSchemas.ts` import in `weave.ts` to pull in `MessageId`, `ProjectId`:

```ts
import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
```

Append to `packages/contracts/src/weave.ts`:

```ts
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
  createdAt: IsoDateTime,
});
export type WeaveRun = typeof WeaveRun.Type;
```

Note: `ProjectId`, `ThreadId`, `MessageId` are already defined in [`baseSchemas.ts`](../../../../packages/contracts/src/baseSchemas.ts) via `makeEntityId`. They are imported as peers of `weave.ts` — no cycle. This gives us brand-level type safety at every seam that touches t3code's thread/project/message identifiers.

- [ ] **Step 7.4: Run the test to verify it passes**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add WeaveRun aggregate struct"
```

---

## Task 8: Add client-dispatchable Weave commands

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

These commands are user-initiated and go through `orchestration.dispatchCommand` RPC:

- `weave.create`
- `weave.blueprint.approve`
- `weave.phase.approve`
- `weave.decision.resolve`
- `weave.exit`

All follow the existing shape: `type: Schema.Literal(...)`, `commandId: CommandId`, `createdAt: IsoDateTime`, plus payload fields.

- [ ] **Step 8.1: Write the failing tests**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import {
  WeaveBlueprintApproveCommand,
  WeaveCreateCommand,
  WeaveDecisionResolveCommand,
  WeaveDispatchableCommand,
  WeaveExitCommand,
  WeavePhaseApproveCommand,
} from "./weave.ts";

const decodeWeaveCreate = Schema.decodeUnknownEffect(WeaveCreateCommand);
const decodeWeaveBlueprintApprove = Schema.decodeUnknownEffect(WeaveBlueprintApproveCommand);
const decodeWeavePhaseApprove = Schema.decodeUnknownEffect(WeavePhaseApproveCommand);
const decodeWeaveDecisionResolve = Schema.decodeUnknownEffect(WeaveDecisionResolveCommand);
const decodeWeaveExit = Schema.decodeUnknownEffect(WeaveExitCommand);
const decodeWeaveDispatchable = Schema.decodeUnknownEffect(WeaveDispatchableCommand);

it.effect("decodes weave.create with required fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveCreate({
      type: "weave.create",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "Add blog",
      vision: "# Goal",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.create");
    assert.strictEqual(parsed.weaveRunId, "run-1");
    assert.strictEqual(parsed.parentThreadId, undefined);
  }),
);

it.effect("decodes weave.blueprint.approve with concurrency cap", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintApprove({
      type: "weave.blueprint.approve",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      blueprintVersion: 1,
      concurrencyCap: 1,
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.blueprintVersion, 1);
    assert.strictEqual(parsed.concurrencyCap, 1);
  }),
);

it.effect("rejects weave.blueprint.approve with concurrencyCap out of range", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWeaveBlueprintApprove({
        type: "weave.blueprint.approve",
        commandId: "cmd-bad",
        weaveRunId: "run-1",
        blueprintVersion: 1,
        concurrencyCap: 9,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes weave.phase.approve", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePhaseApprove({
      type: "weave.phase.approve",
      commandId: "cmd-3",
      weaveRunId: "run-1",
      phaseId: "phase-1",
      approval: "approved",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.approval, "approved");
  }),
);

it.effect("decodes weave.decision.resolve with rationale", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecisionResolve({
      type: "weave.decision.resolve",
      commandId: "cmd-4",
      weaveRunId: "run-1",
      decisionId: "decision-1",
      answer: "jotai",
      byUser: true,
      rationale: "Already in repo.",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.answer, "jotai");
    assert.strictEqual(parsed.byUser, true);
    assert.strictEqual(parsed.rationale, "Already in repo.");
  }),
);

it.effect("decodes weave.exit with reason", () =>
  Effect.gen(function* () {
    for (const reason of ["complete", "aborted"] as const) {
      const parsed = yield* decodeWeaveExit({
        type: "weave.exit",
        commandId: "cmd-5",
        weaveRunId: "run-1",
        reason,
        createdAt: "2026-04-21T00:00:00.000Z",
      });
      assert.strictEqual(parsed.reason, reason);
    }
  }),
);

it.effect("WeaveDispatchableCommand union decodes every variant", () =>
  Effect.gen(function* () {
    const create = yield* decodeWeaveDispatchable({
      type: "weave.create",
      commandId: "cmd-u1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "X",
      vision: "",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(create.type, "weave.create");

    const exit = yield* decodeWeaveDispatchable({
      type: "weave.exit",
      commandId: "cmd-u2",
      weaveRunId: "run-1",
      reason: "aborted",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(exit.type, "weave.exit");
  }),
);
```

- [ ] **Step 8.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL.

- [ ] **Step 8.3: Implement the commands**

Extend the `baseSchemas.ts` import in `weave.ts` to include `CommandId`:

```ts
import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
```

Append to `packages/contracts/src/weave.ts`:

```ts
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
export type WeaveExitCommand = typeof WeaveExitCommand.Type;

export const WeaveDispatchableCommand = Schema.Union([
  WeaveCreateCommand,
  WeaveBlueprintApproveCommand,
  WeavePhaseApproveCommand,
  WeaveDecisionResolveCommand,
  WeaveExitCommand,
]);
export type WeaveDispatchableCommand = typeof WeaveDispatchableCommand.Type;
```

`ConcurrencyCap` was defined in Task 7; reuse it directly. `WeaveExitReason` is extracted so the matching event payload can reference it.

- [ ] **Step 8.4: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add client-dispatchable weave commands (create, approve, resolve, exit)"
```

---

## Task 9: Add internal Weave commands

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

These commands are emitted by server-internal reactors (planner, scheduler, contract conformer) in Slice 3 and must not be accepted from the client. Mirrors the existing `InternalOrchestrationCommand` pattern in [orchestration.ts:722](../../../../packages/contracts/src/orchestration.ts).

- `weave.blueprint.compile`
- `weave.node.dispatch`
- `weave.node.verified`
- `weave.node.failed`

- [ ] **Step 9.1: Write the failing tests**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import {
  WeaveBlueprintCompileCommand,
  WeaveInternalCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeFailedCommand,
  WeaveNodeVerifiedCommand,
} from "./weave.ts";

const decodeWeaveBlueprintCompile = Schema.decodeUnknownEffect(WeaveBlueprintCompileCommand);
const decodeWeaveNodeDispatch = Schema.decodeUnknownEffect(WeaveNodeDispatchCommand);
const decodeWeaveNodeVerified = Schema.decodeUnknownEffect(WeaveNodeVerifiedCommand);
const decodeWeaveNodeFailed = Schema.decodeUnknownEffect(WeaveNodeFailedCommand);
const decodeWeaveInternal = Schema.decodeUnknownEffect(WeaveInternalCommand);

it.effect("decodes weave.blueprint.compile with reason", () =>
  Effect.gen(function* () {
    for (const reason of ["initial", "amendment", "redesign"] as const) {
      const parsed = yield* decodeWeaveBlueprintCompile({
        type: "weave.blueprint.compile",
        commandId: "cmd-c1",
        weaveRunId: "run-1",
        reason,
        createdAt: "2026-04-21T00:00:00.000Z",
      });
      assert.strictEqual(parsed.reason, reason);
    }
  }),
);

it.effect("decodes weave.node.dispatch", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeDispatch({
      type: "weave.node.dispatch",
      commandId: "cmd-d1",
      weaveRunId: "run-1",
      nodeId: "node-1",
      childThreadId: "thread-xyz",
      worktreePath: "/tmp/wt",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.childThreadId, "thread-xyz");
    assert.strictEqual(parsed.worktreePath, "/tmp/wt");
  }),
);

it.effect("decodes weave.node.verified", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeVerified({
      type: "weave.node.verified",
      commandId: "cmd-v1",
      weaveRunId: "run-1",
      nodeId: "node-1",
      verifierOutcome: "tests-passed",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.verifierOutcome, "tests-passed");
  }),
);

it.effect("decodes weave.node.failed with reason", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeFailed({
      type: "weave.node.failed",
      commandId: "cmd-f1",
      weaveRunId: "run-1",
      nodeId: "node-1",
      reason: "Verifier exited with code 1",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.reason, "Verifier exited with code 1");
  }),
);

it.effect("WeaveInternalCommand union decodes every variant", () =>
  Effect.gen(function* () {
    const compile = yield* decodeWeaveInternal({
      type: "weave.blueprint.compile",
      commandId: "cmd-u3",
      weaveRunId: "run-1",
      reason: "initial",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(compile.type, "weave.blueprint.compile");

    const failed = yield* decodeWeaveInternal({
      type: "weave.node.failed",
      commandId: "cmd-u4",
      weaveRunId: "run-1",
      nodeId: "node-1",
      reason: "x",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(failed.type, "weave.node.failed");
  }),
);
```

- [ ] **Step 9.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL.

- [ ] **Step 9.3: Implement the commands**

Append to `packages/contracts/src/weave.ts`:

```ts
// --- Internal (server-only) Weave commands ---
// Emitted by WeavePlanner, WeaveScheduler, WeaveContractConformer reactors
// in Slice 3. Must not be accepted from the client.

export const WeaveBlueprintCompileReason = Schema.Literals(["initial", "amendment", "redesign"]);
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
  createdAt: IsoDateTime,
});
export type WeaveNodeFailedCommand = typeof WeaveNodeFailedCommand.Type;

export const WeaveInternalCommand = Schema.Union([
  WeaveBlueprintCompileCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeVerifiedCommand,
  WeaveNodeFailedCommand,
]);
export type WeaveInternalCommand = typeof WeaveInternalCommand.Type;

// Convenience: a union of every Weave command. Slice 2's decider takes this as input.
export const WeaveCommand = Schema.Union([WeaveDispatchableCommand, WeaveInternalCommand]);
export type WeaveCommand = typeof WeaveCommand.Type;
```

- [ ] **Step 9.4: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add internal weave commands (compile, dispatch, verified, failed)"
```

---

## Task 10: Add Weave event payloads

**Files:**
- Modify: `packages/contracts/src/weave.ts`
- Modify: `packages/contracts/src/weave.test.ts`

Payload-only structs, one per event type. They are wrapped with `EventBaseFields` inside the `OrchestrationEvent` union in Task 12 — matching the pattern for thread/project payloads in `orchestration.ts`.

Events in v0.1 (nine total):

- `weave.created`
- `weave.blueprint-compiled`
- `weave.blueprint-approved`
- `weave.node-dispatched`
- `weave.node-verified`
- `weave.node-failed`
- `weave.decision-resolved`
- `weave.phase-approved`
- `weave.exited`

**Naming note:** commands use dot-segments (`weave.node.dispatch`), events use kebab-case segments after the first dot (`weave.node-dispatched`) — this matches the existing thread/project convention (`thread.created`, `thread.message-sent`, `thread.turn-diff-completed`).

- [ ] **Step 10.1: Write the failing tests**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import {
  WeaveBlueprintApprovedPayload,
  WeaveBlueprintCompiledPayload,
  WeaveCreatedPayload,
  WeaveDecisionResolvedPayload,
  WeaveExitedPayload,
  WeaveNodeDispatchedPayload,
  WeaveNodeFailedPayload,
  WeaveNodeVerifiedPayload,
  WeavePhaseApprovedPayload,
} from "./weave.ts";

const decodeWeaveCreatedPayload = Schema.decodeUnknownEffect(WeaveCreatedPayload);
const decodeWeaveBlueprintCompiledPayload = Schema.decodeUnknownEffect(
  WeaveBlueprintCompiledPayload,
);
const decodeWeaveBlueprintApprovedPayload = Schema.decodeUnknownEffect(
  WeaveBlueprintApprovedPayload,
);
const decodeWeaveNodeDispatchedPayload = Schema.decodeUnknownEffect(WeaveNodeDispatchedPayload);
const decodeWeaveNodeVerifiedPayload = Schema.decodeUnknownEffect(WeaveNodeVerifiedPayload);
const decodeWeaveNodeFailedPayload = Schema.decodeUnknownEffect(WeaveNodeFailedPayload);
const decodeWeaveDecisionResolvedPayload = Schema.decodeUnknownEffect(
  WeaveDecisionResolvedPayload,
);
const decodeWeavePhaseApprovedPayload = Schema.decodeUnknownEffect(WeavePhaseApprovedPayload);
const decodeWeaveExitedPayload = Schema.decodeUnknownEffect(WeaveExitedPayload);

it.effect("decodes WeaveCreatedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveCreatedPayload({
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "X",
      vision: "",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.weaveRunId, "run-1");
  }),
);

it.effect("decodes WeaveBlueprintCompiledPayload with embedded Blueprint", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintCompiledPayload({
      weaveRunId: "run-1",
      version: 1,
      blueprint: {
        version: 1,
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: "2026-04-21T00:00:00.000Z",
        compiledBy: "planner",
      },
      compiledBy: "planner",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.compiledBy, "planner");
  }),
);

it.effect("decodes WeaveBlueprintApprovedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintApprovedPayload({
      weaveRunId: "run-1",
      version: 1,
      concurrencyCap: 1,
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.concurrencyCap, 1);
  }),
);

it.effect("decodes WeaveNodeDispatchedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeDispatchedPayload({
      weaveRunId: "run-1",
      nodeId: "node-1",
      childThreadId: "thread-1",
      worktreePath: "/tmp/wt",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.nodeId, "node-1");
  }),
);

it.effect("decodes WeaveNodeVerifiedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeVerifiedPayload({
      weaveRunId: "run-1",
      nodeId: "node-1",
      verifierOutcome: "tests-passed",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.verifierOutcome, "tests-passed");
  }),
);

it.effect("decodes WeaveNodeFailedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeFailedPayload({
      weaveRunId: "run-1",
      nodeId: "node-1",
      reason: "x",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.reason, "x");
  }),
);

it.effect("decodes WeaveDecisionResolvedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecisionResolvedPayload({
      weaveRunId: "run-1",
      decisionId: "decision-1",
      answer: "a",
      byUser: false,
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.byUser, false);
    assert.strictEqual(parsed.rationale, undefined);
  }),
);

it.effect("decodes WeavePhaseApprovedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePhaseApprovedPayload({
      weaveRunId: "run-1",
      phaseId: "phase-1",
      approval: "approved",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.approval, "approved");
  }),
);

it.effect("decodes WeaveExitedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveExitedPayload({
      weaveRunId: "run-1",
      reason: "complete",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.reason, "complete");
  }),
);
```

- [ ] **Step 10.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: FAIL.

- [ ] **Step 10.3: Implement the payloads**

Append to `packages/contracts/src/weave.ts`:

```ts
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
  occurredAt: IsoDateTime,
});
export type WeaveNodeFailedPayload = typeof WeaveNodeFailedPayload.Type;

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
```

- [ ] **Step 10.4: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run weave.test`

Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(contracts): add weave event payload schemas"
```

---

## Task 11: Extend `OrchestrationAggregateKind` and the `aggregateId` union

**Files:**
- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `packages/contracts/src/orchestration.test.ts`

The existing `OrchestrationAggregateKind` is `Schema.Literals(["project", "thread"])` at [orchestration.ts:765](../../../../packages/contracts/src/orchestration.ts). `EventBaseFields.aggregateId` is `Schema.Union([ProjectId, ThreadId])` at [orchestration.ts:949](../../../../packages/contracts/src/orchestration.ts). Both need `"weave"` / `WeaveRunId` added.

- [ ] **Step 11.1: Write the failing test**

Append to `packages/contracts/src/orchestration.test.ts`:

```ts
import { OrchestrationAggregateKind } from "./orchestration.ts";

const decodeOrchestrationAggregateKind = Schema.decodeUnknownEffect(OrchestrationAggregateKind);

it.effect("accepts 'weave' as an orchestration aggregate kind", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationAggregateKind("weave");
    assert.strictEqual(parsed, "weave");
  }),
);
```

- [ ] **Step 11.2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: FAIL (on the new case).

- [ ] **Step 11.3: Implement the changes**

Edit `packages/contracts/src/orchestration.ts`.

Add the weave import at the top (after the `baseSchemas.ts` import):

```ts
import { WeaveRunId } from "./weave.ts";
```

At line ~765 (`OrchestrationAggregateKind`):

```ts
// Before:
export const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
// After:
export const OrchestrationAggregateKind = Schema.Literals(["project", "thread", "weave"]);
```

At line ~949 (`EventBaseFields.aggregateId`):

```ts
// Before:
aggregateId: Schema.Union([ProjectId, ThreadId]),
// After:
aggregateId: Schema.Union([ProjectId, ThreadId, WeaveRunId]),
```

- [ ] **Step 11.4: Run the test to verify it passes**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: PASS. All prior tests still pass (both unions only grew).

- [ ] **Step 11.5: Typecheck**

Run: `cd packages/contracts && bun typecheck`

Expected: clean. If anything downstream was narrowing on the old `OrchestrationAggregateKind`, the compiler catches it here — but nothing in `packages/contracts` does. Server/web typechecks happen in Task 14.

- [ ] **Step 11.6: Commit**

```bash
git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(contracts): extend OrchestrationAggregateKind and aggregateId union with weave"
```

---

## Task 12: Extend `OrchestrationEventType` and `OrchestrationEvent` with Weave variants

**Files:**
- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `packages/contracts/src/orchestration.test.ts`

Add nine new `type` literals to `OrchestrationEventType` (the enum-of-names union at line ~739), and nine new `Schema.Struct({ ...EventBaseFields, type, payload })` variants to `OrchestrationEvent` (the master union at line ~957). The payloads come from `weave.ts` (Task 10).

- [ ] **Step 12.1: Write the failing test**

Append to `packages/contracts/src/orchestration.test.ts`:

```ts
it.effect("decodes a weave.created event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-w1",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.created",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: "cmd-1",
      causationEventId: null,
      correlationId: "cmd-1",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        projectId: "project-1",
        title: "Add blog",
        vision: "# Goal",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.created");
    assert.strictEqual(event.aggregateKind, "weave");
    if (event.type === "weave.created") {
      assert.strictEqual(event.payload.weaveRunId, "run-1");
    }
  }),
);

it.effect("decodes a weave.blueprint-approved event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-w2",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.blueprint-approved",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: "cmd-2",
      causationEventId: null,
      correlationId: "cmd-2",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        version: 1,
        concurrencyCap: 1,
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.blueprint-approved");
    if (event.type === "weave.blueprint-approved") {
      assert.strictEqual(event.payload.concurrencyCap, 1);
    }
  }),
);

it.effect("decodes a weave.exited event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 3,
      eventId: "event-w3",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.exited",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: "cmd-3",
      causationEventId: null,
      correlationId: "cmd-3",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        reason: "complete",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.exited");
    if (event.type === "weave.exited") {
      assert.strictEqual(event.payload.reason, "complete");
    }
  }),
);
```

- [ ] **Step 12.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: FAIL on the new cases — `"weave.created"` etc. are not valid `type` literals.

- [ ] **Step 12.3: Extend the imports**

Add to the weave import line in `orchestration.ts`:

```ts
import {
  WeaveBlueprintApprovedPayload,
  WeaveBlueprintCompiledPayload,
  WeaveCreatedPayload,
  WeaveDecisionResolvedPayload,
  WeaveExitedPayload,
  WeaveNodeDispatchedPayload,
  WeaveNodeFailedPayload,
  WeaveNodeVerifiedPayload,
  WeavePhaseApprovedPayload,
  WeaveRunId,
} from "./weave.ts";
```

- [ ] **Step 12.4: Extend `OrchestrationEventType`**

At line ~739, add the nine weave event types to the literal list:

```ts
export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  // Weave events (Slice 1)
  "weave.created",
  "weave.blueprint-compiled",
  "weave.blueprint-approved",
  "weave.node-dispatched",
  "weave.node-verified",
  "weave.node-failed",
  "weave.decision-resolved",
  "weave.phase-approved",
  "weave.exited",
]);
```

- [ ] **Step 12.5: Extend `OrchestrationEvent`**

At the end of the `OrchestrationEvent = Schema.Union([ ... ])` array (line ~957), append the nine variants before the closing `])`:

```ts
  // --- Weave events ---
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.created"),
    payload: WeaveCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.blueprint-compiled"),
    payload: WeaveBlueprintCompiledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.blueprint-approved"),
    payload: WeaveBlueprintApprovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.node-dispatched"),
    payload: WeaveNodeDispatchedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.node-verified"),
    payload: WeaveNodeVerifiedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.node-failed"),
    payload: WeaveNodeFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.decision-resolved"),
    payload: WeaveDecisionResolvedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.phase-approved"),
    payload: WeavePhaseApprovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("weave.exited"),
    payload: WeaveExitedPayload,
  }),
```

- [ ] **Step 12.6: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: PASS. All three new weave-event decode cases succeed; all existing tests still pass.

- [ ] **Step 12.7: Commit**

```bash
git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(contracts): extend OrchestrationEvent union with weave variants"
```

---

## Task 13: Extend `OrchestrationCommand` with Weave variants

**Files:**
- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `packages/contracts/src/orchestration.test.ts`

Mirror the pattern: `WeaveDispatchableCommand` variants go into `DispatchableClientOrchestrationCommand` (and through to `ClientOrchestrationCommand`); `WeaveInternalCommand` variants go into `InternalOrchestrationCommand`. Both are reached via the top-level `OrchestrationCommand` union.

- [ ] **Step 13.1: Write the failing test**

Append to `packages/contracts/src/orchestration.test.ts`:

```ts
it.effect("decodes weave.create via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "weave.create",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "Add blog",
      vision: "",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.create");
  }),
);

it.effect("decodes weave.blueprint.compile (internal) via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "weave.blueprint.compile",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      reason: "initial",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.compile");
  }),
);

it.effect("decodes weave.exit via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "weave.exit",
      commandId: "cmd-3",
      weaveRunId: "run-1",
      reason: "complete",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.exit");
  }),
);
```

- [ ] **Step 13.2: Run the tests to verify they fail**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: FAIL — `"weave.create"` etc. aren't in the union yet.

- [ ] **Step 13.3: Extend the weave imports**

Add to the weave import block at the top of `orchestration.ts`:

```ts
import {
  // ... existing payload imports ...
  WeaveBlueprintApproveCommand,
  WeaveBlueprintCompileCommand,
  WeaveCreateCommand,
  WeaveDecisionResolveCommand,
  WeaveExitCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeFailedCommand,
  WeaveNodeVerifiedCommand,
  WeavePhaseApproveCommand,
} from "./weave.ts";
```

- [ ] **Step 13.4: Extend `DispatchableClientOrchestrationCommand`**

At line ~616 (`DispatchableClientOrchestrationCommand = Schema.Union([...])`), append the five dispatchable weave commands:

```ts
const DispatchableClientOrchestrationCommand = Schema.Union([
  // ... existing members ...
  ThreadSessionStopCommand,
  // --- Weave dispatchable commands ---
  WeaveCreateCommand,
  WeaveBlueprintApproveCommand,
  WeavePhaseApproveCommand,
  WeaveDecisionResolveCommand,
  WeaveExitCommand,
]);
```

- [ ] **Step 13.5: Extend `ClientOrchestrationCommand`**

At line ~637, append the same five commands to the `ClientOrchestrationCommand` union (which differs from `DispatchableClient...` only in that it uses `ClientThreadTurnStartCommand`, but all weave commands are the same between the two lists):

```ts
export const ClientOrchestrationCommand = Schema.Union([
  // ... existing members ...
  ThreadSessionStopCommand,
  // --- Weave dispatchable commands ---
  WeaveCreateCommand,
  WeaveBlueprintApproveCommand,
  WeavePhaseApproveCommand,
  WeaveDecisionResolveCommand,
  WeaveExitCommand,
]);
```

- [ ] **Step 13.6: Extend `InternalOrchestrationCommand`**

At line ~722, append the four internal weave commands:

```ts
const InternalOrchestrationCommand = Schema.Union([
  // ... existing members ...
  ThreadRevertCompleteCommand,
  // --- Weave internal commands ---
  WeaveBlueprintCompileCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeVerifiedCommand,
  WeaveNodeFailedCommand,
]);
```

No change needed to the top-level `OrchestrationCommand` union (`OrchestrationCommand = Schema.Union([DispatchableClientOrchestrationCommand, InternalOrchestrationCommand])`) — it picks up both extensions transitively.

- [ ] **Step 13.7: Run the tests to verify they pass**

Run: `cd packages/contracts && bun run test -- --run orchestration.test`

Expected: PASS on all three new cases.

- [ ] **Step 13.8: Typecheck `packages/contracts`**

Run: `cd packages/contracts && bun typecheck`

Expected: clean.

- [ ] **Step 13.9: Commit**

```bash
git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(contracts): extend OrchestrationCommand unions with weave variants"
```

---

## Task 14: Repo-wide Definition-of-Done gate

**Files:**
- None (validation only)

Run every check the [AGENTS.md](../../../../AGENTS.md) task-completion contract demands, from the repo root. These exercise the full monorepo (server / web / shared / desktop / marketing) to confirm the contract extensions don't break any consumer.

- [ ] **Step 14.1: Repo-wide typecheck**

Run from the repo root: `bun typecheck`

Expected: all packages clean. If any downstream file (in `apps/server`, `apps/web`, `packages/shared`) was doing an exhaustiveness check against `OrchestrationEventType`, `OrchestrationAggregateKind`, or a command union without a default case, the compiler will flag it here. **Fix any such failure by adding a no-op branch for the new weave variants** (e.g. `case "weave.created": return undefined;`) — Slice 3 will replace the no-ops with real handlers. Do not catch it with `as never` casts. If you hit this, commit the added no-ops as a separate commit: `chore(server|web): stub weave event handlers pending Slice 3`.

- [ ] **Step 14.2: Repo-wide tests**

Run from the repo root: `bun run test`

Expected: all tests pass, including the 40+ new `weave.test.ts` cases and the 2 new `orchestration.test.ts` cases. No prior tests regress.

- [ ] **Step 14.3: Lint**

Run from the repo root: `bun lint`

Expected: clean.

- [ ] **Step 14.4: Format**

Run from the repo root: `bun fmt`

Expected: no files changed. If files are reformatted, commit the formatting fixups as a separate `chore(contracts): apply oxfmt` commit.

- [ ] **Step 14.5: Verify barrel export**

Run from the repo root: `cd packages/contracts && grep -c 'export \* from "./weave.ts";' src/index.ts`

Expected: `1`.

- [ ] **Step 14.6: Verify schema-only discipline**

Run from the repo root: `grep -En 'console|process\.|setTimeout|setInterval|fetch|import.*fs|import.*path' packages/contracts/src/weave.ts || echo "clean"`

Expected: `clean`. The `weave.ts` file must contain only Schema.* definitions and type aliases — no runtime code. This is the contract [AGENTS.md:31](../../../../AGENTS.md) imposes on the `packages/contracts` package.

- [ ] **Step 14.7: Verify v0.1 spec §1.10 definition of done**

Sanity-check against [v0.1-spec.md §1.10](../../../../../docs/v0.1-spec.md) checklist:

- [ ] `bun typecheck` passes — verified in 14.1.
- [ ] `bun run test` passes with new tests included — verified in 14.2.
- [ ] `bun lint` passes — verified in 14.3.
- [ ] `bun fmt` passes — verified in 14.4.
- [ ] No runtime code added to `contracts` — verified in 14.6.
- [ ] `ProviderInteractionMode` literal union includes `"weave"` — Task 1.
- [ ] Exported from `contracts/src/index.ts` — verified in 14.5.

- [ ] **Step 14.8: Final commit if anything is outstanding**

If Steps 14.1–14.7 all pass with no residual changes, the Task-by-task commits from Tasks 1–13 fully capture Slice 1. Nothing to commit here.

If Step 14.1 required downstream no-op handler stubs, they should have been committed in their own `chore(server|web): stub weave event handlers pending Slice 3` commit. Verify with `git log --oneline origin/main..HEAD`.

- [ ] **Step 14.9: Review commit trail**

Run from the repo root: `git log --oneline origin/main..HEAD`

Expected (13 commits from Tasks 1–13 + optional downstream stub commit):

```
feat(contracts): extend OrchestrationCommand unions with weave variants
feat(contracts): extend OrchestrationEvent union with weave variants
feat(contracts): extend OrchestrationAggregateKind and aggregateId union with weave
feat(contracts): add weave event payload schemas
feat(contracts): add internal weave commands (compile, dispatch, verified, failed)
feat(contracts): add client-dispatchable weave commands (create, approve, resolve, exit)
feat(contracts): add WeaveRun aggregate struct
feat(contracts): add Blueprint struct and BlueprintSource enum
feat(contracts): add WeaveNode struct
feat(contracts): add Scope, WeaveContract, WeavePhase, WeaveDecision structs
feat(contracts): add weave enums (RunStatus, NodeStatus, NodeKind, PhaseApproval, PreAuthScope)
feat(contracts): add weave branded ids (WeaveRunId, WeaveNodeId, …)
feat(contracts): add 'weave' to ProviderInteractionMode literal union
```

Slice 1 is complete. Slice 2 (`decider + projector + invariants`, pure TS, server-side) can now import from `@t3tools/contracts` and destructure the new schemas.

---

## Self-review summary

- **Spec coverage:** every section of v0.1-spec.md §Slice 1 is addressed — §1.1 (files) in file-structure; §1.2 (ProviderInteractionMode) in Task 1; §1.3 (branded IDs) in Task 2; §1.4 (enums) in Task 3; §1.5 (structs) in Tasks 4–7; §1.6 (commands) in Tasks 8–9; §1.7 (domain events) in Task 10; §1.8 (OrchestrationDomainEvent extension) in Tasks 11–13; §1.9 (tests) embedded in each task; §1.10 (DoD) in Task 14. The "Blueprint with mismatched phaseId FAILS" test from §1.9 is explicitly deferred to Slice 2 invariants as §1.9 itself permits.
- **Placeholder scan:** all code in this plan is complete and executable; no "TBD" / "similar to Task N" / "add error handling" / stub references. Every type, helper, and field referenced in later tasks is defined in an earlier one.
- **Type consistency:** `ConcurrencyCap` defined once (Task 7), reused in Task 8 and Task 10. `WeaveExitReason`, `WeaveDecisionResolution`, `WeaveBlueprintCompileReason`, `BlueprintSource` all defined exactly once with the same name used everywhere. Every payload referenced in Task 12 is defined in Task 10 under the same name. Command / event type-literal strings match between command/event pairs and their use sites.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-weave-slice-1-contracts.md`.** Awaiting user review per the handoff directive in the original task. Do not begin execution.
