# Weave v0.1 — Slice 3 (Engine + Scheduler + Planner + Conformer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Pre-flight HEAD check is mandatory on every task.** Same protocol as Slice 2 — see [§"Pre-flight HEAD check protocol"](#pre-flight-head-check-protocol) below.

**Goal:** Wire the pure Slice 2 decider and projector into the main event loop, stand up a sequential Weave execution engine, and deliver an end-to-end Weave Run: `weave.create` RPC → Blueprint compiled by planner → user approves → scheduler walks the DAG → child threads execute each Node → verifier confirms → run completes.

**Architecture:** Four new `Layers/` services under `apps/server/src/orchestration/Layers/` — `WeaveEngine` (single writer per run, persists events), `WeaveScheduler` (DrainableWorker reacting to domain events, picks next Node, allocates worktree, dispatches), `WeavePlanner` (provider turn → Blueprint decode → `weave.blueprint-compiled`), `WeaveContractConformer` (subscribes to `RuntimeReceiptBus`, runs `bun run test` in worktree, emits `weave.node.verified` / `.failed`). Three new dispatchable RPC methods. Extend `OrchestrationReadModel` with `weaveRuns: ReadonlyMap<WeaveRunId, WeaveRunProjection>`. Remove five of the six Slice 1 stubs (the two `"weave" → "default"` interactionMode translations stay — they're permanent architectural bridges, not stubs).

**Tech Stack:** TypeScript, Effect 4 beta (`effect` catalog dep), `@t3tools/contracts` (Slice 1+2 schemas), `vitest` via `bun run test`, `oxlint` / `oxfmt`, SQLite via `SqlClient` + `ManagedRuntime` for tests.

---

## Context: what Slice 3 touches and what it doesn't

Slice 3 is the first slice with side effects. The five deliverable files per [v0.1-spec.md §Slice 3](../../weave/v0.1-spec.md#slice-3--engine--scheduler--planner--basic-reactors):

| File | New/Modify | Purpose |
|---|---|---|
| `apps/server/src/orchestration/Layers/WeaveEngine.ts` | new | Service + Layer. Single writer per run. Persists weave events, broadcasts via `streamDomainEvents`. |
| `apps/server/src/orchestration/Layers/WeaveScheduler.ts` | new | `DrainableWorker`. Reacts to `weave.blueprint-approved` / `weave.node-verified`, picks next ready Node, allocates worktree via `GitCore`, dispatches `weave.node.dispatch`. |
| `apps/server/src/orchestration/Layers/WeavePlanner.ts` | new | Invokes `ProviderService` turn, decodes Blueprint, emits `weave.blueprint-compiled`. |
| `apps/server/src/orchestration/Layers/WeaveContractConformer.ts` | new | Subscribes to `RuntimeReceiptBus` `turn.processing.quiesced` receipts. For weave-child threads, runs `bun run test` in the Node's worktree. Emits `weave.node.verified` or `weave.node.failed`. |
| `apps/server/src/ws.ts` (and the matching contracts) | modify | Three new dispatchable RPC methods: `weave.create`, `weave.blueprint.approve`, `weave.exit`. Others are server-internal. |

**Also in scope** — integration plumbing to unblock the above:

| File | Change |
|---|---|
| `packages/contracts/src/orchestration.ts` | Add `AggregateRef` discriminated union + `aggregateRefOf(event)` narrow helper; extend `OrchestrationReadModel` with `weaveRuns`. |
| `packages/contracts/src/orchestration.ts` | Extend `OrchestrationCommandReceiptsAggregateId` to accept `WeaveRunId` (column already TEXT-typed in SQLite; contract-only change). |
| `apps/server/src/orchestration/decider.ts` | Remove Slice 1 exhaustiveness stub at line 744. Route weave commands to `decideWeaveCommand`. |
| `apps/server/src/orchestration/projector.ts` | Add weave event cases. For each, look up `state.weaveRuns.get(runId) ?? null`, call `projectWeaveEvent`, write back. |
| `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` | Remove `as ProjectId \| ThreadId` casts at lines ~187, ~196, ~285 — use `aggregateRefOf`. Remove `aggregateKind !== "weave"` guards around receipt upsert. |
| `apps/server/src/persistence/Layers/OrchestrationEventStore.ts` | Remove `Effect.die` guard on weave events at line 185. Remove `as ProjectId \| ThreadId` cast. |
| `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` | Add `applyWeaveRunsProjection` projector entry (stub body is acceptable in v0.1 — in-memory projection on `OrchestrationReadModel` is sufficient for Slice 3). |
| `apps/server/src/orchestration/runtimeLayer.ts` | Compose the four new Layers into the orchestration runtime. |

**Out of scope** (stay untouched per spec):

| Site | Why |
|---|---|
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:647` | `"weave" → "default"` interactionMode translation is a permanent architectural bridge. Child threads run in `"default"` mode; the weave outer aggregate never produces provider turns directly. Comment refreshed to drop "Slice 1 stub" label. |
| `apps/server/src/provider/Layers/CodexSessionRuntime.ts:306` | Same as above; Codex API does not know about `"weave"` mode. Comment refreshed. |

**Out of scope per [spec §3.x "v0.1 does not handle"](../../weave/v0.1-spec.md#32-scheduler-behavior-v01--strictly-sequential):**

- Parallel dispatch (concurrency cap enforced at 1 in scheduler)
- PendingDecision gating (planner must produce a Blueprint with zero decisions in v0.1)
- Phase gate smoke tests (run transitions straight from last-Node-verified to `complete`)
- Intervene-in-running-Node (pause/resume/restart)
- Amendment and Redesign (only `reason: "initial"` compiles in v0.1)

---

## Carry-overs from Slice 2

1. **Pre-flight HEAD check** is mandatory on every task (see protocol below). Red-flag: if the subagent reports a test count mismatch vs. controller expectation, treat it as a chain-integrity signal first, flakiness second.

2. **Plan divergences that Slice 2 locked in** — Slice 3 must honor all of them:
   - `WeaveOrchestrationEvent = Extract<OrchestrationEvent, { readonly type: \`weave.${string}\` }>` (narrow by type prefix, not `aggregateKind`, which is a shared union across all events).
   - `createEmptyWeaveProjection` takes a params object (id, projectId, title, vision, ?parentThreadId, ?parentMessageId, ?snapshotContent, status, concurrencyCap, createdAt), not a `WeaveRun`.
   - `PlannedWeaveEvent` uses `DistributiveOmit<T, K>` (local helper) to preserve the discriminated union after `Omit`.
   - Optional payload fields use conditional spread (`...(x !== undefined && { x })`) to satisfy `exactOptionalPropertyTypes`.
   - `envelope(...)` in `weaveDecider.ts` uses `EventId.make(crypto.randomUUID())` and `payload: unknown` with a final cast.
   - `requireBlueprintVersion` reads `projection.currentBlueprint?.version` (**not** `projection.run.currentBlueprintVersion`). See the followup [rename-run-currentBlueprintVersion.md](../followups/2026-04-24-rename-run-currentBlueprintVersion.md).

3. **Formatter scope.** Do NOT run `bun fmt` globally — it reformats `docs/` markdown files unexpectedly. Always format only the specific files you touched:
   ```
   bun fmt path/to/file1.ts path/to/file2.ts
   ```
   If a task genuinely needs repo-wide fmt, run it then `git checkout -- docs/` before committing. Do NOT commit doc changes as part of implementation tasks.

4. **Single canonical branch.** All Slice 3 work lands on `nikrabaev/weave`. `main` tracks `origin/main` and is NOT touched. No merge to main at slice close — just tag `weave-v0.1-slice-3`.

---

## Pre-flight HEAD check protocol

Every task's implementer subagent includes this verbatim, with `<EXPECTED_SHA_AND_TITLE_n>` filled by the controller from the plan's task sequence.

```
## Pre-flight HEAD check (MANDATORY — run first, stop on mismatch)

cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git rev-parse HEAD
git branch --show-current            # must be `nikrabaev/weave`
git log --oneline HEAD~3..HEAD

The top three commits MUST match (newest first):
<EXPECTED_SHA_AND_TITLE_1>
<EXPECTED_SHA_AND_TITLE_2>
<EXPECTED_SHA_AND_TITLE_3>

If ANY mismatch, STOP and report:
"BLOCKED: wrong base — expected top-of-chain <EXPECTED_SHA_1>, got <ACTUAL_SHA>."

Do NOT run git reset / checkout / rebase to repair state — that is the controller's job.

Also verify the baseline test counts (frozen at Slice 2 close):
cd packages/contracts && bun run test 2>&1 | grep -E "Test Files|Tests" | tail -2
  → expect 8 test files, 129 tests passing.

cd apps/server && bun run test 2>&1 | grep -E "Test Files|Tests" | tail -2
  → baseline at Slice 2 close: 945 passing, 2 failing (pre-existing GitManager env,
    unchanged count), 4 skipped. Report both pre-task and post-task counts.
    Note: the 2 GitManager failures are environmental (real git timeouts) and
    occasionally surface as 3 due to flakiness — re-run once if 3 appears.
```

On completion, the implementer reports the starting SHA and final SHA so the controller can reconstruct the chain cheaply.

---

## Branch setup (read-only verification)

Slice 3 starts on `nikrabaev/weave` with the `weave-v0.1-slice-2` tag at HEAD. Before Task 1:

```bash
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git branch --show-current               # must be `nikrabaev/weave`
git tag --list weave-v0.1-slice-2       # must list the tag
git merge-base --is-ancestor weave-v0.1-slice-2 HEAD \
  && echo "Slice 2 tag reachable ✓" \
  || echo "Slice 2 tag not reachable — STOP"
git log --oneline HEAD~3..HEAD          # show the three commits at branch tip
```

If any check fails, stop — the controller must resolve before proceeding.

At Slice 3 close, tag the final commit `weave-v0.1-slice-3` on `nikrabaev/weave`. No merge to main.

---

## File structure

New (created by Slice 3):

```
apps/server/src/orchestration/Layers/
  WeaveEngine.ts              — single-writer per run, persists events, streams
  WeaveEngine.test.ts
  WeaveScheduler.ts           — DrainableWorker, reacts to events, dispatches
  WeaveScheduler.test.ts
  WeavePlanner.ts             — provider turn → Blueprint decode → emit event
  WeavePlanner.test.ts
  WeaveContractConformer.ts   — runs bun test in worktree on quiesce
  WeaveContractConformer.test.ts

apps/server/src/orchestration/
  weaveAggregateRef.ts        — aggregateRefOf helper (returns discriminated ref)
  weaveIntegration.test.ts    — end-to-end: create → compile → approve → run completes
```

Modified (per-task detail below):

```
packages/contracts/src/orchestration.ts         — AggregateRef union, weaveRuns in ReadModel,
                                                  OrchestrationCommandReceiptsAggregateId widened
apps/server/src/orchestration/decider.ts        — route weave commands to decideWeaveCommand
apps/server/src/orchestration/projector.ts      — route weave events to projectWeaveEvent
apps/server/src/orchestration/Layers/OrchestrationEngine.ts
                                                — remove aggregate-id casts + weave receipt guards
apps/server/src/persistence/Layers/OrchestrationEventStore.ts
                                                — remove weave-event Effect.die guard
apps/server/src/orchestration/Layers/ProjectionPipeline.ts
                                                — add placeholder projector entry for weave (no-op body)
apps/server/src/orchestration/runtimeLayer.ts   — compose new Layers into runtime
apps/server/src/ws.ts                           — wire new RPC command types into dispatchCommand
```

Test deliverables per the spec §3.5 DoD:

- All unit tests per Layer pass.
- Existing t3code tests still green (2 pre-existing GitManager env failures remain unchanged).
- New integration test in `weaveIntegration.test.ts`: a Weave Run with a 3-Node Blueprint (scaffold → contract → raw) completes sequentially against a stub provider.

---

## Task 1: `AggregateRef` discriminated union + narrow helper

**Files:**
- Modify: `packages/contracts/src/orchestration.ts` (add `AggregateRef` schema, export)
- Create: `apps/server/src/orchestration/weaveAggregateRef.ts` (server-side `aggregateRefOf` helper)
- Create: `apps/server/src/orchestration/weaveAggregateRef.test.ts`
- Modify: `packages/contracts/src/orchestration.test.ts` — add a round-trip test for `AggregateRef` decode/encode.

**Pre-flight HEAD expectation:** branch tip of `nikrabaev/weave` at `weave-v0.1-slice-2`.

**Rationale:** Slice 1 left the plain-union `aggregateId: ProjectId | ThreadId | WeaveRunId` in `EventBaseFields` (in `packages/contracts/src/orchestration.ts` around line 997). Downstream code that needs to know "given aggregateKind=X, the aggregateId is of type Y" currently casts with `as ProjectId | ThreadId`. Slice 3 introduces a discriminated `AggregateRef` type in contracts AND a server-side narrowing helper that consumes an `OrchestrationEvent` and returns the matching discriminated ref. Minimal ripple: we do NOT rewrite `EventBaseFields` shape (keeping the two fields `aggregateKind` + `aggregateId`) — every existing event fixture stays unchanged. The narrowing happens at call sites that previously had to cast.

- [ ] **Step 1.1: Add `AggregateRef` to contracts.**

In `packages/contracts/src/orchestration.ts`, after the existing `OrchestrationAggregateKind` definition (around line 813), add:

```ts
// AggregateRef — a discriminated pair of (aggregateKind, aggregateId) that
// enforces the type correlation at the schema layer. EventBaseFields still
// stores the two fields separately for backward-compat; at call sites that
// need a narrow typed ref, use `aggregateRefOf(event)` from the server side.
export const AggregateRef = Schema.Union([
  Schema.Struct({ aggregateKind: Schema.Literal("project"), aggregateId: ProjectId }),
  Schema.Struct({ aggregateKind: Schema.Literal("thread"),  aggregateId: ThreadId  }),
  Schema.Struct({ aggregateKind: Schema.Literal("weave"),   aggregateId: WeaveRunId }),
]);
export type AggregateRef = typeof AggregateRef.Type;
```

Add an export to `packages/contracts/src/index.ts` via the existing `./orchestration` re-export (verify it's already a wildcard re-export; if explicit, add `AggregateRef`).

- [ ] **Step 1.2: Contract test — round-trip decode/encode of `AggregateRef`.**

In `packages/contracts/src/orchestration.test.ts`, add a small describe block that decodes three fixtures (one per variant) and asserts the narrowed type is correct. Pattern to match existing tests in that file:

```ts
describe("AggregateRef", () => {
  it("decodes a project ref and narrows aggregateId to ProjectId", () => {
    const decoded = Schema.decodeSync(AggregateRef)({
      aggregateKind: "project",
      aggregateId: ProjectId.make("project-1"),
    });
    expect(decoded.aggregateKind).toBe("project");
    expect(decoded.aggregateId).toBe(ProjectId.make("project-1"));
  });

  it("decodes a thread ref", () => { /* similar */ });
  it("decodes a weave ref", () => { /* similar */ });

  it("rejects a mismatched pair (kind=project, id branded as ThreadId)", () => {
    // Runtime Schema.decode should accept any of the three branded strings as
    // "aggregateId" for any kind because branded strings are structurally
    // compatible. This test documents that enforcement is at TYPE level only.
    // If you want runtime narrowing rejection, the Schema would need
    // kind-specific aggregateId constraints; defer to a followup.
    const decoded = Schema.decodeSync(AggregateRef)({
      aggregateKind: "project",
      aggregateId: ThreadId.make("thread-1"), // structurally a string
    });
    // Accepts at runtime (brands are compile-time); documents the behavior.
    expect(decoded.aggregateKind).toBe("project");
  });
});
```

Document the runtime/type-level distinction explicitly — it matters later.

- [ ] **Step 1.3: Create the server-side narrow helper.**

Create `apps/server/src/orchestration/weaveAggregateRef.ts`:

```ts
import type { AggregateRef, OrchestrationEvent, ProjectId, ThreadId, WeaveRunId } from "@t3tools/contracts";

// aggregateRefOf narrows an OrchestrationEvent's (aggregateKind, aggregateId)
// plain-union pair into a discriminated AggregateRef. This is the single place
// the narrowing cast lives; call sites that were using `as ProjectId | ThreadId`
// should use `aggregateRefOf(event).aggregateId` instead.
export function aggregateRefOf(event: OrchestrationEvent): AggregateRef {
  switch (event.aggregateKind) {
    case "project":
      return { aggregateKind: "project", aggregateId: event.aggregateId as ProjectId };
    case "thread":
      return { aggregateKind: "thread", aggregateId: event.aggregateId as ThreadId };
    case "weave":
      return { aggregateKind: "weave", aggregateId: event.aggregateId as WeaveRunId };
  }
}
```

- [ ] **Step 1.4: Tests for `aggregateRefOf`.**

Create `apps/server/src/orchestration/weaveAggregateRef.test.ts` with three tests, one per aggregateKind. Construct a minimal event envelope for each (`project.created`, `thread.created`, `weave.created`) and assert the returned `AggregateRef` has the expected `aggregateKind` and the correct brand.

- [ ] **Step 1.5: Typecheck, format, test, commit.**

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
bun fmt packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts \
        apps/server/src/orchestration/weaveAggregateRef.ts \
        apps/server/src/orchestration/weaveAggregateRef.test.ts
bun typecheck
cd packages/contracts && bun run test
cd ../../apps/server && bun run test

git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts \
        apps/server/src/orchestration/weaveAggregateRef.ts \
        apps/server/src/orchestration/weaveAggregateRef.test.ts
git commit -m "feat(contracts): add AggregateRef discriminated union + narrow helper"
```

Expected server test delta: +3 tests (rough; the `aggregateRefOf` tests). Contracts test delta: +4. Match prevailing commit style (no Co-Authored-By trailer).

---

## Task 2: Wire `decideWeaveCommand` into the main decider

**Files:**
- Modify: `apps/server/src/orchestration/decider.ts` (remove Slice 1 stub at line ~744)
- Modify: `apps/server/src/orchestration/decider.*.test.ts` — add one test that routes a `weave.create` command through the main decider and asserts it emits `weave.created`. No separate new test file; extend `decider.delete.test.ts`'s sibling pattern or add `decider.weave.test.ts` — match the repo's style.

**Pre-flight HEAD expectation:** top of chain is Task 1's commit.

- [ ] **Step 2.1: Inspect the current decider stub.**

Read `apps/server/src/orchestration/decider.ts:744-753` (the exhaustiveness block that currently rejects weave commands with `OrchestrationCommandInvariantError`). Study the surrounding function signature of `decideOrchestrationCommand({ command, readModel })` so you know what's in scope.

- [ ] **Step 2.2: Replace the weave stub with a delegating case.**

Import `decideWeaveCommand` from `./weaveDecider.ts`. Before the `default:` (or at the beginning of the weave cases, whichever reads cleanly), replace the nine `case "weave.*":` fallthrough block with a single combined case that calls `decideWeaveCommand`. Example shape:

```ts
case "weave.create":
case "weave.blueprint.approve":
case "weave.phase.approve":
case "weave.decision.resolve":
case "weave.exit":
case "weave.blueprint.compile":
case "weave.node.dispatch":
case "weave.node.verified":
case "weave.node.failed": {
  const runId = command.weaveRunId;
  const projection = readModel.weaveRuns.get(runId) ?? null;
  const plannedEvents = yield* decideWeaveCommand({ projection, command });
  // decideWeaveCommand returns PlannedWeaveEvent[] — which is already a weave-
  // aggregate OrchestrationEvent minus `sequence`. Return as-is; the engine
  // assigns sequences during persistence.
  return plannedEvents;
}
```

This relies on Task 3 having added `weaveRuns` to `OrchestrationReadModel`. If Task 3 has not landed yet and you need the file to typecheck, stub out `readModel.weaveRuns` as `new Map()` inline — but the preferred ordering is: Task 3 first, then Task 2 lands clean. If you receive this task with `weaveRuns` already present, no stubbing needed.

**Note:** if the controller dispatches Task 2 before Task 3, STOP and report — the natural order is Task 3 first. The plan orders them 2 then 3 for narrative flow only.

- [ ] **Step 2.3: Add a decider test that covers the weave route.**

Create `apps/server/src/orchestration/decider.weave.test.ts` (matching the naming of `decider.delete.test.ts` / `decider.projectScripts.test.ts`). Cover:

1. `weave.create` command → emits one `weave.created` event when `weaveRuns` is empty.
2. `weave.create` command → rejects when the run already exists in the read model.
3. `weave.blueprint.approve` command → rejects when the run is in `draft` state. (Positive case covered by `weaveDecider.test.ts` already.)

Use a minimal read-model fixture. See `decider.delete.test.ts` for the pattern.

- [ ] **Step 2.4: Typecheck, test, commit.**

```
cd apps/server && bun typecheck && bun run test -- --run src/orchestration/decider
git add apps/server/src/orchestration/decider.ts \
        apps/server/src/orchestration/decider.weave.test.ts
git commit -m "feat(server): route weave commands through weaveDecider in main decider"
```

---

## Task 3: Extend `OrchestrationReadModel` + wire `projectWeaveEvent` into main projector

**Files:**
- Modify: `packages/contracts/src/orchestration.ts` — add `weaveRuns` to `OrchestrationReadModel` (schema + type).
- Modify: `packages/contracts/src/orchestration.test.ts` — update `OrchestrationReadModel` decode tests to include `weaveRuns: new Map()` in fixtures.
- Modify: `apps/server/src/orchestration/projector.ts` — add weave event cases.
- Modify: `apps/server/src/orchestration/projector.test.ts` — add weave event projection tests.

**Pre-flight HEAD expectation:** top three commits Task 2 → Task 1 → Slice 2 tip.

**Important:** the `OrchestrationReadModel` schema currently uses `Schema.Array(...)` for `projects` and `threads`. For `weaveRuns` — which is keyed by `WeaveRunId` — use `Schema.ReadonlyMap({ key: WeaveRunId, value: WeaveRunProjectionSchema })` if the runtime supports it, OR fall back to an array of records. Inspect the existing test fixtures to see how aggregates are serialized; serialization of `Map` to JSON is lossy, so check whether snapshots are JSON-encoded. If yes, prefer `Schema.Array(WeaveRunEntry)` where `WeaveRunEntry = Schema.Struct({ id: WeaveRunId, projection: WeaveRunProjectionSchema })` and the projector maintains invariant that entries are unique by id.

If `WeaveRunProjection` is NOT currently a contract-level schema (Slice 2 made it a server-internal TypeScript type), you have two options:
1. **Promote the type to a contract schema.** Define `WeaveRunProjectionSchema` in `packages/contracts/src/weave.ts` matching the Slice 2 shape (with `Schema.ReadonlyMap` or array equivalents for the maps/sets). Update Slice 2's `WeaveRunProjection` type to derive from it.
2. **Keep `weaveRuns` server-internal.** Don't put it in the contracts-level `OrchestrationReadModel`. Instead, extend `OrchestrationReadModel` with an opaque `weaveRuns: Schema.Any` placeholder and handle serialization server-side. This is a shortcut that avoids schema-level typing but preserves flexibility.

**Recommended:** option 1 — promote `WeaveRunProjection` to a contract schema. It's a load-bearing type and v0.1 Slice 4 will need it in the web layer regardless.

- [ ] **Step 3.1: Promote `WeaveRunProjection` to `packages/contracts/src/weave.ts`.**

Define `WeaveRunProjectionSchema` using the exact same field shape as Slice 2's TS type. Use `Schema.ReadonlyMap` / `Schema.ReadonlySet` for the map/set fields. Export it. In `apps/server/src/orchestration/weaveProjector.ts`, change the line

```ts
export type WeaveRunProjection = { ... };
```

to

```ts
import type { WeaveRunProjection as WeaveRunProjectionFromContracts } from "@t3tools/contracts";
export type WeaveRunProjection = WeaveRunProjectionFromContracts;
```

(Or re-export with a `type ... = Schema.Type<typeof WeaveRunProjectionSchema>` pattern if cleaner. Match the repo's convention from other server-side re-exports of contract types.)

- [ ] **Step 3.2: Extend `OrchestrationReadModel` with `weaveRuns`.**

```ts
// in packages/contracts/src/orchestration.ts, near line 348
export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects:  Schema.Array(OrchestrationProject),
  threads:   Schema.Array(OrchestrationThread),
  weaveRuns: Schema.ReadonlyMap({ key: WeaveRunId, value: WeaveRunProjectionSchema }),
  updatedAt: IsoDateTime,
});
```

If `Schema.ReadonlyMap` doesn't exist in Effect 4 beta, use `Schema.Array(Schema.Struct({ id: WeaveRunId, projection: WeaveRunProjectionSchema }))` and handle the lookup at the server side.

- [ ] **Step 3.3: Update initial snapshot / bootstrap to include empty `weaveRuns`.**

Find every construction of `OrchestrationReadModel` (grep for `snapshotSequence: 0` or similar patterns) and add `weaveRuns: new Map()` (or `[]` for the array variant). Likely sites: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`, test fixtures in `OrchestrationEngine.test.ts`, any seeding utility.

- [ ] **Step 3.4: Wire `projectWeaveEvent` into the main projector.**

In `apps/server/src/orchestration/projector.ts`, find the `default:` case around line 654. Before it, add a combined case for all nine weave event types:

```ts
case "weave.created":
case "weave.blueprint-compiled":
case "weave.blueprint-approved":
case "weave.node-dispatched":
case "weave.node-verified":
case "weave.node-failed":
case "weave.decision-resolved":
case "weave.phase-approved":
case "weave.exited": {
  const runId = event.payload.weaveRunId;
  const existing = model.weaveRuns.get(runId) ?? null;
  const next = yield* projectWeaveEvent(existing, event);
  const nextWeaveRuns = new Map(model.weaveRuns);
  nextWeaveRuns.set(runId, next);
  return { ...nextBase, weaveRuns: nextWeaveRuns };
}
```

Import `projectWeaveEvent` from `./weaveProjector.ts`. Handle the `ReadonlyMap → Map → ReadonlyMap` copy idempotently.

- [ ] **Step 3.5: Add projector tests.**

In `apps/server/src/orchestration/projector.test.ts`, add a describe block that:

1. Creates an initial empty read model.
2. Projects `weave.created` → asserts `model.weaveRuns.size === 1` and the projection has `status: "draft"`.
3. Projects `weave.blueprint-compiled` on top → asserts `status === "reviewing"`.
4. Asserts an unrelated aggregate (thread event) on top does NOT mutate `weaveRuns`.

- [ ] **Step 3.6: Commit.**

```
git add packages/contracts/src/weave.ts packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts \
        apps/server/src/orchestration/weaveProjector.ts \
        apps/server/src/orchestration/projector.ts \
        apps/server/src/orchestration/projector.test.ts \
        apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
git commit -m "feat(server): project weave events into OrchestrationReadModel.weaveRuns"
```

**Note on ordering:** Task 2's weave decider route reads `readModel.weaveRuns` — so Task 3 must land BEFORE Task 2 for a clean commit chain. If the controller dispatches in the 2→3 order per this document, Task 2 must stub `readModel.weaveRuns ?? new Map()` defensively. Recommend: execute in 3→2 order.

---

## Task 4: Persistence — remove `Effect.die` guard + clean up casts

**Files:**
- Modify: `apps/server/src/persistence/Layers/OrchestrationEventStore.ts` (remove lines 185–188 guard; remove `as ProjectId | ThreadId` cast on line 196)
- Modify: `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` (remove `aggregateKind !== "weave"` guards and casts at lines ~187, ~196, ~285 — all three Slice 1 stubs)

**Pre-flight HEAD expectation:** top of chain is Task 3's commit.

- [ ] **Step 4.1: Widen the receipts aggregateId type in contracts.**

In `packages/contracts/src/orchestration.ts`, find `OrchestrationCommandReceipt` (around line 720ish — grep to confirm). The current `aggregateId` field is `Schema.Union([ProjectId, ThreadId])`. Widen to include `WeaveRunId`:

```ts
// OrchestrationCommandReceipt, aggregateId field:
aggregateId: Schema.Union([ProjectId, ThreadId, WeaveRunId]),
```

The SQLite column `stream_id` is already plain TEXT (no CHECK constraint per Slice 1 stub audit) — no DB migration needed.

- [ ] **Step 4.2: Remove the `Effect.die` guard in `OrchestrationEventStore.ts`.**

Delete lines 185–188 (the `if (event.aggregateKind === "weave") return Effect.die(...)` block). Replace the cast on line 196 (`streamId: event.aggregateId as ProjectId | ThreadId`) with the narrowed form — import `aggregateRefOf` from `apps/server/src/orchestration/weaveAggregateRef.ts` and use `aggregateRefOf(event).aggregateId`.

- [ ] **Step 4.3: Remove the three guards and casts in `OrchestrationEngine.ts`.**

Three sites. Pattern for each: replace the `as ProjectId | ThreadId` cast with `aggregateRefOf(savedEvent).aggregateId` (or `aggregateRefOf(lastSavedEvent).aggregateId`). Remove the `if (aggregateRef.aggregateKind !== "weave")` guard — after the receipts schema is widened, weave receipts are valid.

Sites to touch:
- ~line 177–195: `commandReceiptRepository.upsert` on accepted. Remove the `if` guard; use `aggregateRefOf(lastSavedEvent).aggregateId`.
- ~line 272–292: `commandReceiptRepository.upsert` on rejected. Same pattern, `aggregateRefOf(...)`.

- [ ] **Step 4.4: Regression test — persisting a weave event no longer dies.**

In `apps/server/src/persistence/Layers/OrchestrationEventStore.test.ts` (look for it; if missing, create a minimal one modeled on an existing `*Store.test.ts`), add a test that persists a single `weave.created` event and asserts the row is present. Construct the event via a helper or inline minimal envelope.

- [ ] **Step 4.5: Regression test — OrchestrationEngine receipts on weave events.**

In `apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts`, add a test that dispatches a `weave.create` command, waits for the resulting event to persist, and queries `commandReceiptRepository` for the receipt. Asserts:
- `status === "accepted"`
- `aggregateKind === "weave"`
- `aggregateId` is the `WeaveRunId` from the command

- [ ] **Step 4.6: Commit.**

```
git add packages/contracts/src/orchestration.ts \
        apps/server/src/persistence/Layers/OrchestrationEventStore.ts \
        apps/server/src/persistence/Layers/OrchestrationEventStore.test.ts \
        apps/server/src/orchestration/Layers/OrchestrationEngine.ts \
        apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts
git commit -m "feat(server): persist weave events and receipts (remove Slice 1 die/guards)"
```

---

## Task 5: Update Slice 1 comments on the two permanent translations

**Files:**
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:647` (comment refresh)
- Modify: `apps/server/src/provider/Layers/CodexSessionRuntime.ts:306` (comment refresh)

**Pre-flight HEAD expectation:** top of chain is Task 4's commit.

These are NOT stubs — they're permanent architectural translations. The Slice 1 stub comments on them should be refreshed so future readers don't think they're outstanding debt.

- [ ] **Step 5.1: Update the comment in `ProviderCommandReactor.ts`.**

Replace the Slice 1 stub comment (around line 643–646) with:

```
// Weave child threads run their own provider turns in "default" mode — the
// outer weave aggregate never produces provider turns directly. This is
// permanent architectural behavior, not a stub.
```

- [ ] **Step 5.2: Update the comment in `CodexSessionRuntime.ts`.**

Replace the Slice 1 stub comment (around line 305) with:

```
// Codex API does not know about "weave" mode; weave child threads run in
// "default" mode at the Codex layer. Permanent translation, not a stub.
```

- [ ] **Step 5.3: Commit.**

```
git add apps/server/src/orchestration/Layers/ProviderCommandReactor.ts \
        apps/server/src/provider/Layers/CodexSessionRuntime.ts
git commit -m "docs(server): clarify that weave→default interactionMode translations are permanent"
```

Small cleanup commit — no code change, no test change. Keeps the stub inventory accurate for Slice 4+.

---

## Task 6: `WeaveEngine` — service + Layer + persistence tests

**Files:**
- Create: `apps/server/src/orchestration/Layers/WeaveEngine.ts`
- Create: `apps/server/src/orchestration/Layers/WeaveEngine.test.ts`

**Pre-flight HEAD expectation:** top of chain is Task 5's commit.

**Design:** `WeaveEngine` is a thin wrapper over the existing `OrchestrationEngineService`. Every weave command goes through the main engine (which routes to `decideWeaveCommand` per Task 2), so `WeaveEngine` does NOT re-implement command dispatch. Instead it exposes:

1. `dispatchWeaveCommand(command: WeaveCommand)` — convenience wrapper around `orchestrationEngine.dispatch(command)` that preserves the `Deferred`-style return but with weave-specific error typing.
2. `getWeaveRun(runId: WeaveRunId): Effect.Effect<WeaveRunProjection | null>` — reads the current `OrchestrationReadModel.weaveRuns.get(runId)`.
3. `streamWeaveEvents: Stream.Stream<WeaveOrchestrationEvent>` — filters the main engine's `streamDomainEvents` to only weave events.

- [ ] **Step 6.1: Define the service interface.**

```ts
// WeaveEngine.ts
export interface WeaveEngineShape {
  readonly dispatchWeaveCommand: (command: WeaveCommand) =>
    Effect.Effect<{ sequence: number }, OrchestrationDispatchError>;
  readonly getWeaveRun: (runId: WeaveRunId) =>
    Effect.Effect<WeaveRunProjection | null>;
  readonly streamWeaveEvents: Stream.Stream<WeaveOrchestrationEvent>;
}

export class WeaveEngineService extends Context.Service<WeaveEngineService, WeaveEngineShape>()(
  "@t3tools/server/WeaveEngineService",
) {}
```

Match the existing pattern in `OrchestrationEngine.ts` (class-extending-Context.Service).

- [ ] **Step 6.2: Implement the Layer.**

```ts
export const WeaveEngineLive = Layer.effect(
  WeaveEngineService,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    return {
      dispatchWeaveCommand: (command) => engine.dispatch(command),
      getWeaveRun: (runId) =>
        engine.getReadModel().pipe(Effect.map((m) => m.weaveRuns.get(runId) ?? null)),
      get streamWeaveEvents() {
        return engine.streamDomainEvents.pipe(
          Stream.filter((e): e is WeaveOrchestrationEvent => e.type.startsWith("weave.")),
        );
      },
    };
  }),
);
```

Narrow the stream filter predicate correctly so TypeScript infers the element type.

- [ ] **Step 6.3: Layer tests.**

In `WeaveEngine.test.ts`, mirror the scaffolding pattern from `OrchestrationEngine.test.ts` (`ManagedRuntime.make(layer)` + `SqlitePersistenceMemory`). Provide `WeaveEngineLive` and `OrchestrationEngineLive` together. Cover:

1. `dispatchWeaveCommand({ type: "weave.create", ... })` → returns `{ sequence: N }` where N is >= 1.
2. `getWeaveRun(runId)` → returns the projection post-create with `status: "draft"`.
3. `streamWeaveEvents` → yields `weave.created` event, skips any concurrently-published thread event (test by dispatching a thread command too and asserting only the weave event appears in the filtered stream).

- [ ] **Step 6.4: Commit.**

```
git add apps/server/src/orchestration/Layers/WeaveEngine.ts \
        apps/server/src/orchestration/Layers/WeaveEngine.test.ts
git commit -m "feat(server): add WeaveEngine service wrapping OrchestrationEngine"
```

---

## Task 7: `WeavePlanner` — provider turn → Blueprint decode → emit event

**Files:**
- Create: `apps/server/src/orchestration/Layers/WeavePlanner.ts`
- Create: `apps/server/src/orchestration/Layers/WeavePlanner.test.ts`

**Pre-flight HEAD expectation:** top of chain is Task 6's commit.

**Design:** `WeavePlanner` listens for `weave.created` events on the weave event stream. For each, it:
1. Invokes a `ProviderService` turn with a specialized system prompt (see [spec §3.3](../../weave/v0.1-spec.md#33-planner-behavior)).
2. Parses the provider's text output as JSON.
3. Decodes the JSON via `Schema.decode(Blueprint)` from `@t3tools/contracts`.
4. On success: dispatches an **internal** `weave.blueprint.compile` command, which returns `[]` from the decider (no event), AND separately persists a `weave.blueprint-compiled` domain event via the engine. Per spec: "the planner emits `weave.blueprint-compiled` directly" — this means the planner directly calls the engine's persistence hook, not through the decider.
5. On parse/decode failure: retry once with error context in the prompt. On second failure: emit a synthetic event that marks the run as failed — for v0.1, just dispatch `weave.exit` with `reason: "aborted"` and let the user retry. Log the failure via the existing observability stack.

**Important:** "planner emits `weave.blueprint-compiled` directly" requires an engine API that lets the planner commit events without going through `decideOrchestrationCommand`. Two options:

- **Option A (cleaner):** extend `WeaveEngine` with a `persistPlannerEvent(event: WeaveBlueprintCompiledPayload, command: WeaveBlueprintCompileCommand)` method that wraps the direct persistence call. This keeps the planner's trust boundary at one method.
- **Option B (simpler, less clean):** have the planner dispatch the internal `weave.blueprint.compile` command AND separately call a low-level persistence API. Worse separation of concerns.

**Recommended: Option A.** Add `persistPlannerEvent` to `WeaveEngine` in this task.

- [ ] **Step 7.1: Extend `WeaveEngine` with `persistPlannerEvent`.**

In `apps/server/src/orchestration/Layers/WeaveEngine.ts`, add to the shape:

```ts
readonly persistPlannerEvent: (input: {
  readonly command: WeaveBlueprintCompileCommand;
  readonly blueprint: Blueprint;
  readonly compiledBy: BlueprintSource;
}) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError>;
```

Implementation: build a `weave.blueprint-compiled` envelope via a helper similar to `weaveDecider.ts`'s `envelope(...)`, then call a new lower-level append method on `OrchestrationEngineService` if one exists, OR wrap into a synthetic internal command.

Inspect `OrchestrationEngine.ts` to see if it already exposes a direct-persist path. If not, add one: a method `appendSystemEvent(event: OrchestrationEvent)` that skips the decider and goes straight to the persistence pipeline + broadcast. This IS a cross-cutting change to `OrchestrationEngine` — that's acceptable since the planner needs it.

Extend `WeaveEngine.test.ts` with a test: call `persistPlannerEvent` with a minimal Blueprint, then `getWeaveRun(runId)` and assert `currentBlueprint.version === 1` and `run.status === "reviewing"`.

- [ ] **Step 7.2: Define the `WeavePlanner` service.**

```ts
export interface WeavePlannerShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class WeavePlannerService extends Context.Service<WeavePlannerService, WeavePlannerShape>()(
  "@t3tools/server/WeavePlannerService",
) {}
```

- [ ] **Step 7.3: Implement the Layer.**

Use a `DrainableWorker` (see `makeDrainableWorker` in `ProviderCommandReactor.ts`). Inside `start()`, fork a subscription to `weaveEngine.streamWeaveEvents`, filter for `weave.created`, enqueue each to the worker. The worker's body:

```ts
function* processCreatedEvent(event: WeaveOrchestrationEvent & { type: "weave.created" }) {
  const runId = event.payload.weaveRunId;
  const vision = event.payload.vision;
  const snapshot = event.payload.snapshotContent ?? "";

  // Call ProviderService.sendTurn with a planner system prompt + vision.
  const provider = yield* ProviderService;
  const rawOutput = yield* callPlannerTurn(provider, { vision, snapshot });

  // Parse + decode.
  const blueprint = yield* decodeBlueprintWithRetry(rawOutput, { vision, snapshot, provider });

  if (blueprint._tag === "Right") {
    yield* weaveEngine.persistPlannerEvent({
      command: synthesizeCompileCommand(runId),
      blueprint: blueprint.right,
      compiledBy: "planner",
    });
  } else {
    // Second failure — abort the run.
    yield* weaveEngine.dispatchWeaveCommand({
      type: "weave.exit",
      commandId: serverCommandId("planner-abort"),
      weaveRunId: runId,
      reason: "aborted",
      createdAt: new Date().toISOString(),
    });
  }
}
```

The helper `callPlannerTurn` invokes `ProviderService`'s relevant method (inspect `ProviderService` to find the correct call — likely `sendTurn({ threadId, messages })` with a stub thread or a specialized planner-context API). If there's no ergonomic way to invoke a provider without a thread, document the gap in a followup and use a minimal thread fixture internal to the planner.

- [ ] **Step 7.4: Planner tests.**

In `WeavePlanner.test.ts`, use a stub `ProviderService` that returns hardcoded JSON output for the Blueprint. Cover:

1. Happy path: stub provider returns valid JSON → planner emits `weave.blueprint-compiled` → projection updates.
2. Invalid JSON: stub returns garbage → planner retries once → second call returns valid JSON → planner emits.
3. Both calls fail: stub returns garbage twice → planner dispatches `weave.exit` with `reason: "aborted"`.

- [ ] **Step 7.5: Commit.**

```
git add apps/server/src/orchestration/Layers/WeaveEngine.ts \
        apps/server/src/orchestration/Layers/WeaveEngine.test.ts \
        apps/server/src/orchestration/Layers/WeavePlanner.ts \
        apps/server/src/orchestration/Layers/WeavePlanner.test.ts
git commit -m "feat(server): add WeavePlanner — compile Blueprint from vision via provider turn"
```

---

## Task 8: `WeaveScheduler` — pick next ready Node, allocate worktree, dispatch

**Files:**
- Create: `apps/server/src/orchestration/Layers/WeaveScheduler.ts`
- Create: `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts`

**Pre-flight HEAD expectation:** top of chain is Task 7's commit.

**Design:** per [spec §3.2](../../weave/v0.1-spec.md#32-scheduler-behavior-v01--strictly-sequential):

1. Subscribe to `weaveEngine.streamWeaveEvents`.
2. On `weave.blueprint-approved` → compute initial ready set from the blueprint's DAG (all nodes with empty `dependsOn`). Enqueue the first one (in topological + ordinal + id tiebreaker order).
3. On `weave.node-verified` → recompute ready set (nodes whose ancestors are now all verified). Enqueue the next one. If no more ready nodes AND no running nodes → run is complete (the decider's auto-complete cascade in Slice 2 handles this; the scheduler just stops).
4. Worker body for each enqueued Node:
   - Allocate a worktree via `GitCore.createWorktree({...})` on a new branch off the project's base branch. Branch name: `weave-{runId-short}-{nodeId-slug}`.
   - Create a child thread via the main engine's `thread.create` command with metadata `{ weaveChild: { runId, nodeId } }` and `interactionMode: "default"` and the worktree's path.
   - Issue `weave.node.dispatch` command with `childThreadId` and `worktreePath`.
   - Issue `thread.turn-start-requested` on the child thread with the Node's spec as the user message. (The main engine will kick the provider.)

The scheduler is strictly sequential in v0.1 (`concurrencyCap = 1` enforced). Don't implement parallel dispatch.

- [ ] **Step 8.1: Define the service interface.** Model after `ProviderCommandReactor` — `start()` + `drain`.

- [ ] **Step 8.2: Implement the Layer.**

Scaffolding:

```ts
export const WeaveSchedulerLive = Layer.effect(
  WeaveSchedulerService,
  Effect.gen(function* () {
    const weaveEngine = yield* WeaveEngineService;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const git = yield* GitCoreService;  // name may differ; find the actual service tag

    const worker = yield* makeDrainableWorker(processSchedulerDecision);

    const start = Effect.fn("WeaveScheduler.start")(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(weaveEngine.streamWeaveEvents, (event) => {
          if (event.type === "weave.blueprint-approved" || event.type === "weave.node-verified") {
            return worker.enqueue(event);
          }
          return Effect.void;
        }),
      );
    });

    return { start, drain: worker.drain };
  }),
);
```

The `processSchedulerDecision` function body:

```ts
function* processSchedulerDecision(event: ...) {
  const runId = event.payload.weaveRunId;
  const run = yield* weaveEngine.getWeaveRun(runId);
  if (run === null || run.currentBlueprint === null || run.run.status !== "running") {
    return; // nothing to do
  }
  const readySet = computeReadySet(run);
  // Pick first — topological order by dependsOn depth, then by phase ordinal, then by id.
  const next = pickNext(readySet, run);
  if (next === undefined) return; // nothing ready; wait

  // Allocate worktree.
  const branchName = `weave-${runId.slice(0, 8)}-${slugifyNodeId(next.id)}`;
  const worktree = yield* git.createWorktree({
    cwd: run.run.projectId /* resolve to workspace root */,
    branch: "main", // TODO: read project's default branch; v0.1 hard-codes "main"
    newBranch: branchName,
  });

  // Create child thread + issue dispatch.
  const childThreadId = makeThreadId();
  yield* orchestrationEngine.dispatch({
    type: "thread.create",
    // ... with weaveChild metadata, interactionMode "default", worktreePath = worktree.path
  });
  yield* weaveEngine.dispatchWeaveCommand({
    type: "weave.node.dispatch",
    commandId: serverCommandId("weave-node-dispatch"),
    weaveRunId: runId,
    nodeId: next.id,
    childThreadId,
    worktreePath: worktree.path,
    createdAt: new Date().toISOString(),
  });
  yield* orchestrationEngine.dispatch({
    type: "thread.turn-start-requested",
    threadId: childThreadId,
    // ... payload with the Node's description as the user message
  });
}

function computeReadySet(run: WeaveRunProjection): WeaveNode[] {
  return run.currentBlueprint!.nodes.filter((n) => {
    if (run.nodeStatuses.get(n.id) !== "pending") return false;
    return n.dependsOn.every((dep) => run.nodeStatuses.get(dep) === "verified");
  });
}
```

**Required pre-dispatch step:** the decider requires node status to be `"ready"` (not `"pending"`) before `weave.node.dispatch`. Options:

- Add a `weave.node.ready` command + event to bump status from `pending → ready` before dispatch. (Invasive; requires contract change.)
- Compute ready-set on the fly, pass as a synthetic `ready` transition inside the scheduler's own state, and have the scheduler construct the dispatch event with status transitioned via projector-coupled event. (Also invasive.)
- **Shortcut for v0.1:** tweak the decider's `requireNodeStatus` check for `weave.node.dispatch` to accept `["pending", "ready"]` in v0.1. In v0.2 add explicit ready-state transitions. Document the shortcut as tech debt.

**Recommended:** the shortcut. Update `weaveDecider.ts`'s `weave.node.dispatch` case to allow `["pending", "ready"]`. File a followup to reintroduce explicit ready-state in v0.2.

- [ ] **Step 8.3: Apply the decider shortcut.**

In `apps/server/src/orchestration/weaveDecider.ts`, `weave.node.dispatch` case:

```ts
yield* requireNodeStatus({
  projection: run,
  command,
  nodeId: command.nodeId,
-  allowed: ["ready"],
+  allowed: ["pending", "ready"],  // v0.1: scheduler skips explicit ready transition; see followup.
});
```

Update `weaveDecider.test.ts` accordingly (the test that expected rejection on "pending" needs to be updated or removed; keep it as a comment-documented tech debt note).

File a followup `docs/superpowers/followups/2026-04-24-reintroduce-weave-node-ready-transition.md` explaining the shortcut.

- [ ] **Step 8.4: Scheduler tests.**

Use a stub `WeaveEngine` and a stub `GitCore` that records `createWorktree` calls. Cover:

1. On `weave.blueprint-approved` with 1 Node and no dependencies → worker enqueues, stub GitCore records one `createWorktree` call, one `thread.create` dispatch, one `weave.node.dispatch` dispatch, one `thread.turn-start-requested` dispatch.
2. On `weave.node-verified` for node-A when node-B (depends on A) is pending → enqueues node-B.
3. On `weave.node-verified` when all nodes are verified → enqueues nothing (no new dispatches).
4. Skips when run status is not `running` (e.g. after `weave.exited`).

- [ ] **Step 8.5: Commit.**

```
git add apps/server/src/orchestration/Layers/WeaveScheduler.ts \
        apps/server/src/orchestration/Layers/WeaveScheduler.test.ts \
        apps/server/src/orchestration/weaveDecider.ts \
        apps/server/src/orchestration/weaveDecider.test.ts \
        docs/superpowers/followups/2026-04-24-reintroduce-weave-node-ready-transition.md
git commit -m "feat(server): add WeaveScheduler — sequential dispatch with worktree allocation"
```

---

## Task 9: `WeaveContractConformer` — naive verifier on `turn.processing.quiesced`

**Files:**
- Create: `apps/server/src/orchestration/Layers/WeaveContractConformer.ts`
- Create: `apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts`

**Pre-flight HEAD expectation:** top of chain is Task 8's commit.

**Design:** per [spec §3.4](../../weave/v0.1-spec.md#34-weavecontractconformer--v01-naive). For v0.1, the verifier is uniformly: "run `bun run test` in the Node's worktree; exit code 0 → verified, nonzero → failed."

Subscribe to `RuntimeReceiptBus.streamEventsForTest` (note: "forTest" in the name is misleading — the bus is used in production too; see `ProviderRuntimeIngestion` for the pattern). Filter for `turn.processing.quiesced` receipts. For each:

1. Look up the thread via `ProjectionThreadRepository.getById` (or similar). Check if the thread's metadata has `weaveChild: { runId, nodeId }`.
2. If yes, resolve the node's worktree path from the `WeaveRunProjection.childThreads.get(nodeId)`.
3. Spawn `bun run test` in that worktree via the Node standard library (`child_process.execFile` via `NodeContext`), capturing exit code and stdout+stderr.
4. Dispatch `weave.node.verified` (exit 0, `verifierOutcome: "bun run test exit 0"`) or `weave.node.failed` (nonzero, `reason: "bun run test exit ${code}"`).

- [ ] **Step 9.1: Define the service + Layer.** Same service pattern as WeaveScheduler.

- [ ] **Step 9.2: Implement.**

The hard parts:
- Accessing thread metadata to check for `weaveChild`. Inspect how `ProjectionThreadsRepository.getById` returns; likely via a `projectionThreadRepository` service tag.
- Running an external process. Use `NodeContext`'s `spawn` / `execFile` (inspect the existing codebase for precedent — there's almost certainly a `CommandExecutor` service or similar; if not, use `child_process` with an `Effect.async` wrapper).
- Ensuring the spawned process is non-blocking: wrap the spawn in an `Effect.async` or `Effect.promise` with a timeout (cap at 120s for v0.1).

- [ ] **Step 9.3: Tests.**

Stub `RuntimeReceiptBusTest` to inject a `turn.processing.quiesced` receipt. Stub the command executor to return exit 0 or exit 1 deterministically. Cover:

1. Non-weave child thread → conformer ignores (no command dispatched).
2. Weave child thread, exit 0 → dispatches `weave.node.verified`.
3. Weave child thread, exit 1 → dispatches `weave.node.failed`.
4. Process timeout (exceeds 120s cap) → dispatches `weave.node.failed` with reason "timeout".

- [ ] **Step 9.4: Commit.**

```
git add apps/server/src/orchestration/Layers/WeaveContractConformer.ts \
        apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts
git commit -m "feat(server): add WeaveContractConformer — naive bun-test verifier"
```

---

## Task 10: Compose Layers into the runtime

**Files:**
- Modify: `apps/server/src/orchestration/runtimeLayer.ts` (add the four new Layers to the composition root)

**Pre-flight HEAD expectation:** top of chain is Task 9's commit.

- [ ] **Step 10.1: Add the four new Layers to `OrchestrationLayerLive`.**

```ts
export const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)),
  WeaveEngineLive.pipe(Layer.provide(OrchestrationEngineLive)),
  WeavePlannerLive.pipe(Layer.provide(WeaveEngineLive), Layer.provide(ProviderServiceLive)),
  WeaveSchedulerLive.pipe(Layer.provide(WeaveEngineLive), Layer.provide(GitCoreLive)),
  WeaveContractConformerLive.pipe(
    Layer.provide(WeaveEngineLive),
    Layer.provide(RuntimeReceiptBusLive),
    Layer.provide(ProjectionThreadRepositoryLive),
  ),
);
```

Inspect the actual runtime layer file for the real composition pattern and match it. The shape above is illustrative.

- [ ] **Step 10.2: Ensure each new Layer's `start()` is invoked at runtime.**

The startup sequence for ProviderCommandReactor and ProviderRuntimeIngestion is in a server bootstrap file — grep for `.start()` to find it. Add `weavePlanner.start()`, `weaveScheduler.start()`, `weaveContractConformer.start()` in the same place.

- [ ] **Step 10.3: Smoke-test the composed runtime.**

Add a layer composition test that instantiates the full orchestration layer with all Weave services and verifies no service-missing errors at layer init time. This is a regression guard against forgetting to provide a dependency.

- [ ] **Step 10.4: Commit.**

```
git add apps/server/src/orchestration/runtimeLayer.ts apps/server/src/<bootstrap-file>
git commit -m "feat(server): compose Weave Layers into the orchestration runtime"
```

---

## Task 11: RPC — three new dispatchable methods

**Files:**
- Modify: `apps/server/src/ws.ts` (or the route file the Explore identified)
- Possibly modify: `packages/contracts/src/orchestration.ts` (if `ORCHESTRATION_WS_METHODS` needs new entries — probably NOT needed, since all commands flow through the single `dispatchCommand` method)
- Modify: `apps/web/src/...` client-side — OUT OF SCOPE; Slice 4 handles the web. But verify that the existing web dispatch method can already handle arbitrary `WeaveCommand` types (it likely can since it's a polymorphic `dispatchCommand`).

**Pre-flight HEAD expectation:** top of chain is Task 10's commit.

**Design per Explore:** the existing RPC has a single `orchestration.dispatchCommand` method that takes an `OrchestrationCommand` (which now includes `WeaveDispatchableCommand` after Slice 1). Slice 3's job is to verify the existing dispatch path routes weave commands correctly and add tests that exercise it.

- [ ] **Step 11.1: Verify `normalizeDispatchCommand` accepts weave commands.**

Read `apps/server/src/ws.ts` around the `dispatchCommand` handler (line ~548 per Explore). If `normalizeDispatchCommand` currently rejects weave types, remove the rejection. Commonly it decodes against `DispatchableClientOrchestrationCommand` — which, per Slice 1, already includes `WeaveDispatchableCommand`.

- [ ] **Step 11.2: Add an RPC integration test.**

Create `apps/server/src/ws.weave.test.ts` (match repo convention). Boot the full orchestration layer in test mode. Send a JSON `dispatchCommand` RPC with `{ type: "weave.create", ... }`. Assert the response has a sequence number AND that `getWeaveRun(runId)` returns a draft projection.

- [ ] **Step 11.3: Commit.**

```
git add apps/server/src/ws.ts apps/server/src/ws.weave.test.ts
git commit -m "test(server): verify weave.create / approve / exit dispatch via RPC"
```

---

## Task 12: End-to-end integration test — 3-Node Blueprint completes

**Files:**
- Create: `apps/server/src/orchestration/weaveIntegration.test.ts`

**Pre-flight HEAD expectation:** top of chain is Task 11's commit.

This is the spec §3.5 "Definition of done" third bullet: "A Weave Run with a 3-Node Blueprint (scaffold → contract → raw) completes sequentially against a stub provider."

- [ ] **Step 12.1: Stub provider that returns a fixed Blueprint.**

Construct a stub `ProviderService` that, when `sendTurn` is called with the planner's prompt signature, returns a hardcoded JSON Blueprint: 1 phase, 3 nodes (scaffold → contract → raw, dependsOn chain). When `sendTurn` is called on a child thread, returns an immediate "quiesce" without producing output (enough for the conformer to run its verifier).

Stub the conformer's `bun run test` invocation so it always returns exit 0 (no actual process spawn).

- [ ] **Step 12.2: The test scenario.**

```ts
describe("Weave Run end-to-end", () => {
  it("completes a 3-node sequential run from create to complete", async () => {
    const { run, engine, weaveEngine, dispose } = await bootFullRuntime(stubProvider, stubConformer);
    try {
      const runId = makeWeaveRunId();

      // 1. create
      await run(weaveEngine.dispatchWeaveCommand(createCommand(runId)));

      // 2. wait for planner to emit weave.blueprint-compiled
      await waitForRunStatus(weaveEngine, runId, "reviewing");

      // 3. approve
      await run(weaveEngine.dispatchWeaveCommand(approveCommand(runId, 1)));

      // 4. wait for scheduler to dispatch node A, conformer to verify, scheduler to dispatch node B, ...
      //    ... and finally the decider's auto-complete cascade to land.
      await waitForRunStatus(weaveEngine, runId, "complete");

      const finalRun = await run(weaveEngine.getWeaveRun(runId));
      expect(finalRun?.run.status).toBe("complete");
      expect(finalRun?.nodeStatuses.get(nodeA)).toBe("verified");
      expect(finalRun?.nodeStatuses.get(nodeB)).toBe("verified");
      expect(finalRun?.nodeStatuses.get(nodeC)).toBe("verified");
    } finally {
      await dispose();
    }
  });
});
```

`waitForRunStatus` is a test helper that polls `getWeaveRun` with exponential backoff up to a 30s timeout.

- [ ] **Step 12.3: Run the integration test.**

```
cd apps/server && bun run test -- --run src/orchestration/weaveIntegration.test.ts
```

Expect: 1 test passes within 30s. If it hangs, diagnose — likely the scheduler isn't subscribed correctly, or the conformer isn't receiving receipts.

- [ ] **Step 12.4: Commit.**

```
git add apps/server/src/orchestration/weaveIntegration.test.ts
git commit -m "test(server): end-to-end Weave Run with 3-node Blueprint via stub provider"
```

---

## Task 13: Repo-wide DoD gate + tag Slice 3 close

**Files:** none (validation only).

**Pre-flight HEAD expectation:** top of chain is Task 12's commit.

Per [spec §3.5](../../weave/v0.1-spec.md#35-definition-of-done-3):

- [ ] **Step 13.1: `bun typecheck`** from repo root. Expected: all 10 packages clean (modulo the pre-existing `Effect.fail` style message, not an error). Any new error in `apps/server` code is a regression.

- [ ] **Step 13.2: `bun run test`** from repo root. Expected: all passing except the 2 pre-existing GitManager env failures. Capture the pre/post test counts; new expected delta is approximately +40 tests from all Slice 3 additions (4 layers × ~4 tests + integration test + decider route tests + contract tests). Exact number depends on how many tests each subagent wrote.

- [ ] **Step 13.3: `bun lint`** from repo root. Expected: 0 errors. Pre-existing warnings in `apps/web/**` unchanged.

- [ ] **Step 13.4: `bun fmt`** from repo root — if files reformatted, commit as `chore(server): apply oxfmt`. Do NOT commit doc/ reformats — revert them first.

- [ ] **Step 13.5: Spec DoD grep-based verification.**

  - All Slice 1 stubs removed except the two permanent translations (sites 4 and 6):
    ```
    grep -nR "Slice 1 stub" apps/server/src/
    # Expected: only matches in ProviderCommandReactor.ts:~647 and CodexSessionRuntime.ts:~306,
    # and their comments should say "permanent architectural behavior" or similar — NOT "stub".
    ```
  - `Effect.die.*weave` pattern absent:
    ```
    grep -nR "Effect.die.*weave" apps/server/src/
    # Expected: no matches.
    ```
  - No `as ProjectId | ThreadId` correlation casts in the three engine sites:
    ```
    grep -nR 'as ProjectId | ThreadId' apps/server/src/orchestration/Layers/OrchestrationEngine.ts \
                                      apps/server/src/persistence/Layers/OrchestrationEventStore.ts
    # Expected: no matches.
    ```

- [ ] **Step 13.6: Commit trail review.**

```
git log --oneline weave-v0.1-slice-2..HEAD
```

Expected (newest first, 12 commits +/- 1 for any fmt fixups):
```
[optional] chore(server): apply oxfmt
test(server): end-to-end Weave Run with 3-node Blueprint via stub provider
test(server): verify weave.create / approve / exit dispatch via RPC
feat(server): compose Weave Layers into the orchestration runtime
feat(server): add WeaveContractConformer — naive bun-test verifier
feat(server): add WeaveScheduler — sequential dispatch with worktree allocation
feat(server): add WeavePlanner — compile Blueprint from vision via provider turn
feat(server): add WeaveEngine service wrapping OrchestrationEngine
docs(server): clarify that weave→default interactionMode translations are permanent
feat(server): persist weave events and receipts (remove Slice 1 die/guards)
feat(server): project weave events into OrchestrationReadModel.weaveRuns
feat(server): route weave commands through weaveDecider in main decider
feat(contracts): add AggregateRef discriminated union + narrow helper
```

- [ ] **Step 13.7: Tag the slice.**

```
git tag weave-v0.1-slice-3
# optional: git push origin nikrabaev/weave weave-v0.1-slice-3
```

No merge to `main`. Weave work stays on `nikrabaev/weave`.

---

## Self-review summary

- **Spec coverage** ([§Slice 3](../../weave/v0.1-spec.md#slice-3--engine--scheduler--planner--basic-reactors)):
  - §3.1 files: WeaveEngine (Task 6), WeaveScheduler (Task 8), WeavePlanner (Task 7), WeaveContractConformer (Task 9), wsServer routes (Task 11). ✓
  - §3.2 Scheduler behavior: Task 8 implements steps 1–9. Parallel/PendingDecision/Phase-gate deferred per spec. ✓
  - §3.3 Planner behavior: Task 7 implements system prompt, retry-once, abort on second fail. ✓
  - §3.4 naive verifier: Task 9 runs `bun run test` in worktree, dispatches verified/failed. ✓
  - §3.5 DoD: Task 13 validates end-to-end. Task 12 is the integration test specified in DoD bullet 3. ✓

- **Carry-overs addressed:**
  - Slice 1 stubs 1, 3a, 3b, 5 removed (Tasks 2, 4). Stub 2 ("weave branch in `commandToAggregateRef`") becomes production code during Task 2 routing. Stubs 4 and 6 reclassified as permanent (Task 5 comment refresh).
  - `(aggregateKind, aggregateId)` correlation: resolved via `AggregateRef` + `aggregateRefOf` (Task 1), consumed in Tasks 2, 3, 4.
  - Slice 2 design divergences honored in Task 1's `WeaveOrchestrationEvent` narrowing + `envelope` helper reuse.

- **Placeholder scan:** every step has concrete files + code OR explicit pointers to existing files to inspect. Tasks 8 and 9 contain the most open-ended exploration (GitCore API, NodeContext spawn API) — acceptable because the subagent must match the repo's conventions, which this plan can't enumerate without re-exploring during execution.

- **Type consistency:** `WeaveRunProjection` type used consistently across Tasks 2, 3, 6, 7, 8 — promoted to contracts in Task 3. `AggregateRef` defined in Task 1, consumed in Tasks 2, 3, 4. `PlannedWeaveEvent` stays server-internal (defined in Slice 2's `weaveDecider.ts`).

- **Known open questions surfaced for execution-time decisions:**
  - How exactly does `ProviderService` accept a planner-style turn (`sendTurn` with no thread, or a synthetic thread)? Task 7 documents the gap.
  - Is there an existing `CommandExecutor` service for spawning external processes? Task 9 documents the gap.
  - Does the Effect 4 beta `Schema.ReadonlyMap` exist? Task 3 provides an array-of-entries fallback.
  - Is the decider shortcut (accepting `pending` as ready for `weave.node.dispatch`) acceptable for v0.1? Task 8 documents + followup-files the shortcut.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-24-weave-v01-slice-3-engine-scheduler-planner.md`.** Awaiting user review per the handoff directive.

When approved, use **superpowers:subagent-driven-development**. Per-task model guidance:

- Tasks 1, 3, 6, 7, 8, 9, 12: **sonnet** — novel files, cross-cutting service interfaces, complex Layer wiring, integration tests.
- Tasks 2, 4, 5, 10, 11: **haiku** — mechanical stub removal, comment refresh, composition root wiring.
- Task 13: **controller** (directly) — validation-only DoD gate.

**Execution order:** 1 → 3 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Task 3 must precede Task 2 (Task 2 reads `readModel.weaveRuns`). Everything else is ordered naturally.
