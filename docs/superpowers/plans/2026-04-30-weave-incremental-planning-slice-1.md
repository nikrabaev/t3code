# Weave Incremental Planning — Slice 1: Schema Deltas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-30-weave-incremental-planning-design.md`](../specs/2026-04-30-weave-incremental-planning-design.md)

**Goal:** Land the schema-level contracts that incremental planning needs — new `WeaveNodeKind` literal, new `WeaveBlueprintCompileReason` literal, new `WeaveBlueprintExtendedPayload` event, new `WeaveBlueprintExtendCommand`, and new optional `planningDepthCap` field on `WeaveRun`. No runtime behavior changes; pure schema.

**Architecture:** Schema-only slice in `packages/contracts/src`. Each addition is independently decode/encode-tested. The downstream runtime (planner, decider, projector, conformer, scheduler, web) is unaffected by Slice 1 — those wire-ups land in subsequent slices.

**Tech Stack:** Effect 4 beta (`Schema.Literals`, `Schema.Struct`, `Schema.Union`), `@effect/vitest` (`it.effect`), `node:assert/strict`.

**Out of scope for Slice 1:**

- Any planner / decider / projector / conformer / scheduler change. New schemas are unused at runtime end of this slice.
- Web changes (new types appear via the existing contracts re-export but are not yet rendered).
- Decoder / validator for the phase-planner agent's emitted JSON (Slice 3).

**Definition of done:**

- All new schemas decode/encode correctly with positive and negative tests.
- `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` all pass.
- No existing test regresses.
- Six small, focused commits — one per task.

---

## File structure

| File                                           | Change                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/weave.ts`              | Extend `WeaveNodeKind`, extend `WeaveBlueprintCompileReason`, add optional `planningDepthCap` to `WeaveRun`, add `WeaveBlueprintExtendedPayload`, add `WeaveBlueprintExtendCommand`, extend `WeaveInternalCommand` union |
| `packages/contracts/src/weave.test.ts`         | New tests for every schema change above                                                                                                                                                                                  |
| `packages/contracts/src/orchestration.ts`      | Add `"weave.blueprint-extended"` to `OrchestrationEventType` literal union; add corresponding variant to `OrchestrationEvent` union; import `WeaveBlueprintExtendedPayload`                                              |
| `packages/contracts/src/orchestration.test.ts` | New test asserting the new event variant decodes                                                                                                                                                                         |

`weave.ts` and `weave.test.ts` carry most of the change. `orchestration.ts` only adds the event-union plumbing so the new payload is reachable through the existing `OrchestrationEvent` union.

---

## Task 1: Extend `WeaveNodeKind` with `"planning"`

**Files:**

- Modify: `packages/contracts/src/weave.ts:54-60`
- Test: `packages/contracts/src/weave.test.ts:94-100`

- [ ] **Step 1: Update the test loop to include `"planning"`**

In `packages/contracts/src/weave.test.ts`, change the existing literal loop from `["raw", "scaffold", "contract", "utility"]` to include `"planning"`:

```ts
it.effect("accepts every WeaveNodeKind literal", () =>
  Effect.gen(function* () {
    for (const k of ["raw", "scaffold", "contract", "utility", "planning"] as const) {
      assert.strictEqual(yield* decodeWeaveNodeKind(k), k);
    }
  }),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: FAIL on the literal `"planning"` because the schema doesn't include it yet.

- [ ] **Step 3: Add `"planning"` to the `WeaveNodeKind` schema**

In `packages/contracts/src/weave.ts`, change:

```ts
export const WeaveNodeKind = Schema.Literals([
  "raw", // feature implementation (default)
  "scaffold", // project structure, tooling
  "contract", // interface-authoring
  "utility", // shared helper / migration / fixture
]);
```

to:

```ts
export const WeaveNodeKind = Schema.Literals([
  "raw", // feature implementation (default)
  "scaffold", // project structure, tooling
  "contract", // interface-authoring
  "utility", // shared helper / migration / fixture
  "planning", // emits a Blueprint extension (sub-DAG); not code
]);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: PASS for `accepts every WeaveNodeKind literal` and all other existing weave.test cases.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(weave): add planning to WeaveNodeKind"
```

---

## Task 2: Extend `WeaveBlueprintCompileReason` with `"phase-planning"`

**Files:**

- Modify: `packages/contracts/src/weave.ts` (the line declaring `WeaveBlueprintCompileReason`)
- Test: `packages/contracts/src/weave.test.ts` (new test)

- [ ] **Step 1: Add a failing test for the new literal**

Append to `packages/contracts/src/weave.test.ts` after the existing `WeaveNodeKind` test block:

```ts
import { WeaveBlueprintCompileReason } from "./weave.ts";

const decodeWeaveBlueprintCompileReason = Schema.decodeUnknownEffect(WeaveBlueprintCompileReason);

it.effect("accepts every WeaveBlueprintCompileReason literal", () =>
  Effect.gen(function* () {
    for (const r of ["initial", "amendment", "redesign", "phase-planning"] as const) {
      assert.strictEqual(yield* decodeWeaveBlueprintCompileReason(r), r);
    }
  }),
);

it.effect("rejects an unknown WeaveBlueprintCompileReason", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeWeaveBlueprintCompileReason("nope"));
    assert.strictEqual(result._tag, "Failure");
  }),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: FAIL on `"phase-planning"` because the schema doesn't include it yet.

- [ ] **Step 3: Add `"phase-planning"` to the schema**

In `packages/contracts/src/weave.ts`, find:

```ts
export const WeaveBlueprintCompileReason = Schema.Literals(["initial", "amendment", "redesign"]);
```

Change to:

```ts
export const WeaveBlueprintCompileReason = Schema.Literals([
  "initial",
  "amendment",
  "redesign",
  "phase-planning",
]);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: PASS for both the positive-loop test and the reject-unknown test.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(weave): add phase-planning to WeaveBlueprintCompileReason"
```

---

## Task 3: Add `planningDepthCap` to `WeaveRun`

**Files:**

- Modify: `packages/contracts/src/weave.ts` (the `WeaveRun` struct)
- Test: `packages/contracts/src/weave.test.ts` (new tests)

- [ ] **Step 1: Add a failing test for `planningDepthCap`**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { WeaveRun } from "./weave.ts";

const decodeWeaveRun = Schema.decodeUnknownEffect(WeaveRun);

it.effect("decodes a WeaveRun without planningDepthCap (field is optional)", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-1",
      projectId: "project-1",
      title: "Test run",
      vision: "do the thing",
      status: "draft",
      concurrencyCap: 1,
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.planningDepthCap, undefined);
  }),
);

it.effect("decodes a WeaveRun with planningDepthCap = 3", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-2",
      projectId: "project-1",
      title: "Capped run",
      vision: "do the other thing",
      status: "draft",
      concurrencyCap: 1,
      planningDepthCap: 3,
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.planningDepthCap, 3);
  }),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: FAIL on the second test (the field is currently neither optional nor present, so unknown-key error or undefined access).

- [ ] **Step 3: Add `planningDepthCap` to the `WeaveRun` schema**

In `packages/contracts/src/weave.ts`, find the `WeaveRun` struct:

```ts
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
```

Insert `planningDepthCap` (optional, non-negative integer) before `createdAt`:

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: PASS for both new tests and all existing tests (the field is optional, so existing fixtures keep working).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(weave): add optional planningDepthCap to WeaveRun"
```

---

## Task 4: Add `WeaveBlueprintExtendedPayload`

**Files:**

- Modify: `packages/contracts/src/weave.ts` (new schema)
- Test: `packages/contracts/src/weave.test.ts` (new tests)

- [ ] **Step 1: Add failing tests for the payload**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { WeaveBlueprintExtendedPayload } from "./weave.ts";

const decodeWeaveBlueprintExtendedPayload = Schema.decodeUnknownEffect(
  WeaveBlueprintExtendedPayload,
);

it.effect("round-trips a WeaveBlueprintExtendedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintExtendedPayload({
      weaveRunId: "run-1",
      version: 2,
      plannerNodeId: "phase-1-planner",
      addedNodeIds: ["task-1", "task-2"],
      occurredAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.weaveRunId, "run-1");
    assert.strictEqual(parsed.version, 2);
    assert.strictEqual(parsed.plannerNodeId, "phase-1-planner");
    assert.deepStrictEqual(parsed.addedNodeIds, ["task-1", "task-2"]);
  }),
);

it.effect("rejects a WeaveBlueprintExtendedPayload missing plannerNodeId", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWeaveBlueprintExtendedPayload({
        weaveRunId: "run-1",
        version: 2,
        addedNodeIds: [],
        occurredAt: "2026-04-30T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: FAIL on import — `WeaveBlueprintExtendedPayload` does not exist yet.

- [ ] **Step 3: Add the payload schema**

In `packages/contracts/src/weave.ts`, immediately after the existing `WeaveBlueprintCompiledPayload` definition (search the file for `WeaveBlueprintCompiledPayload`), append:

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: PASS for both new tests; no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(weave): add WeaveBlueprintExtendedPayload schema"
```

---

## Task 5: Add `WeaveBlueprintExtendCommand` and extend `WeaveInternalCommand`

**Files:**

- Modify: `packages/contracts/src/weave.ts` (new command + union extension)
- Test: `packages/contracts/src/weave.test.ts` (new tests)

- [ ] **Step 1: Add failing tests for the command**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { WeaveBlueprintExtendCommand, WeaveInternalCommand } from "./weave.ts";

const decodeWeaveBlueprintExtendCommand = Schema.decodeUnknownEffect(WeaveBlueprintExtendCommand);
const decodeWeaveInternalCommand = Schema.decodeUnknownEffect(WeaveInternalCommand);

it.effect("round-trips a WeaveBlueprintExtendCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintExtendCommand({
      type: "weave.blueprint.extend",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      plannerNodeId: "phase-1-planner",
      addedNodeIds: ["task-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.extend");
    assert.strictEqual(parsed.plannerNodeId, "phase-1-planner");
    assert.deepStrictEqual(parsed.addedNodeIds, ["task-1"]);
  }),
);

it.effect("WeaveInternalCommand union accepts weave.blueprint.extend", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveInternalCommand({
      type: "weave.blueprint.extend",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      plannerNodeId: "phase-1-planner",
      addedNodeIds: [],
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.extend");
  }),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: FAIL on import — `WeaveBlueprintExtendCommand` does not exist yet.

- [ ] **Step 3: Add the command schema and extend the internal-command union**

In `packages/contracts/src/weave.ts`, locate the existing internal-commands block (search for `WeaveInternalCommand`). Add the new command struct just before `WeaveInternalCommand` is declared:

```ts
// Internal command emitted when a Planning Node's dispatch produces a valid
// sub-DAG. Causes the decider to bump BlueprintVersion and append the listed
// Nodes under the planner. Server-only; not accepted from the client.
export const WeaveBlueprintExtendCommand = Schema.Struct({
  type: Schema.Literal("weave.blueprint.extend"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  plannerNodeId: WeaveNodeId,
  addedNodeIds: Schema.Array(WeaveNodeId),
  createdAt: IsoDateTime,
});
export type WeaveBlueprintExtendCommand = typeof WeaveBlueprintExtendCommand.Type;
```

Then update the existing `WeaveInternalCommand` union to include the new command:

```ts
export const WeaveInternalCommand = Schema.Union([
  WeaveBlueprintCompileCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeVerifiedCommand,
  WeaveNodeFailedCommand,
  WeaveBlueprintExtendCommand,
]);
export type WeaveInternalCommand = typeof WeaveInternalCommand.Type;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: PASS for both new tests; existing union tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(weave): add WeaveBlueprintExtendCommand"
```

---

## Task 6: Wire `weave.blueprint-extended` into `OrchestrationEvent`

**Files:**

- Modify: `packages/contracts/src/orchestration.ts`
- Test: `packages/contracts/src/orchestration.test.ts` (new test)

This task is the only one outside `weave.ts`/`weave.test.ts`. It plumbs the new payload into the canonical `OrchestrationEvent` discriminated union so engine/projector code can dispatch on it.

- [ ] **Step 1: Add a failing test for the new event variant**

Append to `packages/contracts/src/orchestration.test.ts` (or an existing weave-events test block in that file — search for `weave.blueprint-compiled` and add adjacent):

```ts
import { OrchestrationEvent } from "./orchestration.ts";

const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);

it.effect("decodes a weave.blueprint-extended event", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-1",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.blueprint-extended",
      occurredAt: "2026-04-30T00:00:00.000Z",
      commandId: "cmd-1",
      causationEventId: null,
      correlationId: "cmd-1",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        version: 2,
        plannerNodeId: "phase-1-planner",
        addedNodeIds: ["task-1"],
        occurredAt: "2026-04-30T00:00:00.000Z",
      },
    });
    assert.strictEqual(parsed.type, "weave.blueprint-extended");
  }),
);
```

The exact `import { OrchestrationEvent }` line and `Schema.decodeUnknownEffect` factory may already exist near the top of `orchestration.test.ts` — check before adding to avoid duplicates.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && bun run test src/orchestration.test.ts`

Expected: FAIL — the union currently has no member matching `type: "weave.blueprint-extended"`.

- [ ] **Step 3: Add the event variant to `OrchestrationEvent`**

In `packages/contracts/src/orchestration.ts`:

a) Find the existing import block that already pulls weave payloads (line ~27 imports `WeaveBlueprintCompiledPayload`, `WeaveCreatedPayload`, etc.). Add `WeaveBlueprintExtendedPayload` to that import:

```ts
import {
  // ... existing imports unchanged
  WeaveBlueprintCompiledPayload,
  WeaveBlueprintExtendedPayload,
  WeaveCreatedPayload,
  // ... rest unchanged
} from "./weave.ts";
```

b) Find `OrchestrationEventType` (around line 870). Add `"weave.blueprint-extended"` to the literal list, grouped with the other weave events:

```ts
export const OrchestrationEventType = Schema.Literals([
  // ... unchanged ...
  "weave.created",
  "weave.blueprint-compiled",
  "weave.blueprint-extended",
  "weave.blueprint-approved",
  // ... rest unchanged
]);
```

c) Find the `OrchestrationEvent` union (around line 1209). Add the new variant adjacent to `weave.blueprint-compiled`:

```ts
Schema.Struct({
  ...EventBaseFields,
  type: Schema.Literal("weave.blueprint-compiled"),
  payload: WeaveBlueprintCompiledPayload,
}),
Schema.Struct({
  ...EventBaseFields,
  type: Schema.Literal("weave.blueprint-extended"),
  payload: WeaveBlueprintExtendedPayload,
}),
Schema.Struct({
  ...EventBaseFields,
  type: Schema.Literal("weave.blueprint-approved"),
  payload: WeaveBlueprintApprovedPayload,
}),
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/contracts && bun run test src/orchestration.test.ts`

Expected: PASS for the new test.

Then run the broader set to confirm no regression: `cd packages/contracts && bun run test`

Expected: All contracts tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(weave): wire weave.blueprint-extended into OrchestrationEvent"
```

---

## Task 7: Whole-repo verification

After Task 6, the new schemas exist and decode. The downstream apps/packages that import from `@t3tools/contracts` may need a sanity check — particularly if any TS file does an exhaustive `switch` on `WeaveNodeKind` or on event types.

**Files:**

- No file changes expected. This task only verifies and (if needed) adds non-exhaustive guards.

- [ ] **Step 1: Run repo-wide typecheck**

Run: `bun typecheck`

Expected: PASS.

If a TS narrowing error appears (e.g., `Switch is not exhaustive — case "planning" not handled`), the offending switch is in a downstream consumer that assumes the closed `WeaveNodeKind` set. Two options for the failing site:

- **If the file is in this slice's scope (a contract or test file):** add a default case that throws `UnsupportedNodeKindError` or returns a neutral value.
- **If the file is in a downstream slice (planner/decider/projector/scheduler/conformer/web):** treat `"planning"` as a no-op for now, with a TODO comment naming the slice that will own it. The runtime code never produces a `kind: "planning"` Node until Slice 2, so the no-op is dead code through the end of Slice 1.

A switch-narrowing fix template:

```ts
switch (node.kind) {
  case "raw":
  case "scaffold":
  case "contract":
  case "utility":
    // existing branches, unchanged
    return existingHandler(node);
  case "planning":
    // TODO(slice-2): emitted by meta-planner; handled in WeaveScheduler.
    return existingHandler(node); // or a sensible no-op for this caller
}
```

- [ ] **Step 2: Run repo-wide tests**

Run: `bun run test`

Expected: PASS. The only newly-passing tests are the ones added in Tasks 1–6; all previously-passing tests continue to pass.

- [ ] **Step 3: Run lint and format**

Run: `bun lint && bun fmt`

Expected: Clean. If `bun fmt` rewrites files, stage the formatting fixes.

- [ ] **Step 4: Commit any guard fixes (if Step 1 required them)**

If Step 1 forced you to add `"planning"` no-op branches in downstream code:

```bash
git add <list-of-files-touched>
git commit -m "feat(weave): guard downstream WeaveNodeKind switches for planning kind"
```

If no downstream changes were needed, skip this step. Slice 1 ends with all six commits from Tasks 1–6 plus (optionally) one guard commit.

---

## Self-review checklist

Run through this once Task 7 is done.

- **Spec coverage.** Verify each Slice 1 deliverable from the spec maps to a task here:
  - `WeaveNodeKind += "planning"` → Task 1
  - `WeaveBlueprintCompileReason += "phase-planning"` → Task 2
  - `WeaveRun.planningDepthCap` → Task 3
  - `WeaveBlueprintExtendedPayload` → Task 4
  - `WeaveBlueprintExtendCommand` + union → Task 5
  - `weave.blueprint-extended` event variant → Task 6

- **No placeholder language.** The plan should contain no `TBD`, `TODO`, "implement later," or vague "add validation"-style steps. (Task 7's TODO note is intentional — it names the next slice that owns the missing branch.)

- **Type consistency.** Field names match between schema and tests:
  - `plannerNodeId` (not `planningNodeId`, not `plannerId`)
  - `addedNodeIds` (not `newNodeIds`)
  - `planningDepthCap` (not `planningDepth`, not `maxPlanningDepth`)

- **Commit hygiene.** Six small commits, each touching only the files for its task; one optional follow-up commit in Task 7 if downstream guards were needed.

---

## What ships at end of Slice 1

A typechecking, fully-tested set of schemas covering every contract incremental planning needs. **Runtime behavior unchanged** — the new event type is never emitted, the new command is never accepted, the new node kind is never produced. Slice 2 (meta-planner refactor) starts wiring the runtime to use these contracts.
