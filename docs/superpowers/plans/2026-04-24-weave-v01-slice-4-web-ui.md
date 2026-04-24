# Weave v0.1 — Slice 4 (Web UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Pre-flight HEAD check is mandatory on every task.** Same protocol as Slice 3 — see [§"Pre-flight HEAD check protocol"](#pre-flight-head-check-protocol) below.

**Goal:** Deliver the end-to-end Weave UX in the browser: a `/weave` slash command that snapshots the parent chat and compiles a Blueprint, a distinct sidebar row per Weave Run, a three-pane Weave view (chat sidebar + blueprint canvas + inspector), live execution counters, and a completion banner. When this lands, a user types `/weave`, watches a plan get drafted and approved, and sees nodes dispatch and verify sequentially against a real provider — all without leaving the browser.

**Architecture:** Contract-first surface extension (`OrchestrationShellSnapshot` carries weave-run summaries; a new `subscribeWeaveRun` RPC carries full projections) feeding a Zustand slice (`weaveRunsById`) that stays in sync via the same envelope the sidebar already uses. UI is thirteen new components under `apps/web/src/components/weave/`, two new routes under `apps/web/src/routes/`, and a minimal extension to the existing composer slash-command registry.

**Tech Stack:** TypeScript, Effect Schema, TanStack Router, Zustand, Tailwind CSS, BaseUI / shadcn-ish primitives at `apps/web/src/components/ui/`, Vitest browser mode + Playwright + MSW for browser tests, `bun typecheck` / `bun run test` / `bun lint` / `bun fmt`.

---

## Context: what Slice 4 touches and what it doesn't

Slice 4 is the first slice users interact with. Slice 3 delivered a working engine; Slice 4 makes it visible. Nothing in the decider, projector, engine, scheduler, planner, or conformer changes.

Per [v0.1-spec.md §Slice 4](../../weave/v0.1-spec.md#slice-4--web-ui-intake--list-form-blueprint--inspector), the required artifacts are:

| File | New/Modify | Purpose |
|---|---|---|
| `apps/web/src/routes/_weave.$environmentId.$weaveRunId.tsx` | new | Top-level Weave Run route |
| `apps/web/src/routes/_weave.$environmentId.$weaveRunId.node.$nodeId.tsx` | new | Node drill-down |
| `apps/web/src/components/weave/WeaveView.tsx` | new | Shell; picks sub-view by status |
| `apps/web/src/components/weave/WeaveIntakeView.tsx` | new | Placeholder while Blueprint compiles |
| `apps/web/src/components/weave/WeaveBlueprintList.tsx` | new | v0.1 list form — grouped by Phase |
| `apps/web/src/components/weave/WeaveNodeCard.tsx` | new | Per-Node row |
| `apps/web/src/components/weave/WeaveInspector.tsx` | new | Right panel embedding child-thread `ChatView` |
| `apps/web/src/components/weave/WeaveExecutionHeader.tsx` | new | Counters + locked concurrency slider + Run/Pause |
| `apps/web/src/components/weave/WeaveRunSidebarItem.tsx` | new | Sidebar row |
| `apps/web/src/components/weave/WeaveCreatedMarker.tsx` | new | Parent-chat anchor |
| `apps/web/src/weave/weaveStore.ts` | new | Zustand slice + selectors (see §Open-questions) |
| `apps/web/src/weave/weaveRouteSearch.ts` | new | Route search params |
| `apps/web/src/weave/weaveThreadSnapshot.ts` | new | Markdown-snapshot of a thread's history |

**Also in scope** — integration plumbing:

| File | Change |
|---|---|
| `packages/contracts/src/orchestration.ts` | Extend `OrchestrationShellSnapshot` with `weaveRuns: Array<OrchestrationWeaveRunShell>`; extend `OrchestrationShellStreamEvent` with `weave-run-upserted` / `weave-run-removed`; add `ORCHESTRATION_WS_METHODS.subscribeWeaveRun`, `OrchestrationSubscribeWeaveRunInput`, `OrchestrationWeaveRunStreamItem`. |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | Build weave-run summaries from `readModel.weaveRuns` into the shell snapshot. |
| `apps/server/src/orchestration/Layers/ShellStreamService.ts` (if one exists — otherwise the shell-stream producer) | Emit `weave-run-upserted` / `weave-run-removed` when weave events land. |
| `apps/server/src/ws.ts` | Add `[ORCHESTRATION_WS_METHODS.subscribeWeaveRun]` handler mirroring `subscribeThread`. |
| `apps/web/src/rpc/wsRpcClient.ts` | Expose `subscribeWeaveRun` on the client. |
| `apps/web/src/environments/runtime/service.ts` | Wire ref-counted `subscribeWeaveRun` subscriptions (mirror `attachThreadDetailSubscription`). |
| `apps/web/src/store.ts` | Add `weaveRunsById` and `weaveRunDetailById` slices, wire `applyEnvironmentShellEvent` / `applyEnvironmentWeaveRunDetailEvent`. |
| `apps/web/src/composer-logic.ts` | Extend `ComposerSlashCommand` union + `parseStandaloneComposerSlashCommand` to include `"weave"`. |
| `apps/web/src/components/chat/ChatComposer.tsx` and `ComposerCommandMenu.tsx` | Handle the `/weave` slash command submit path. |
| `apps/web/src/components/Sidebar.tsx` | Render `WeaveRunSidebarItem` for weave runs in the project's group. |
| `apps/web/src/components/ChatView.tsx` | Render `WeaveCreatedMarker` at the message position where `/weave` fired. |

**Out of scope** (per spec §"Out of scope for v0.1"):

- React Flow graph canvas (v0.2)
- Parallel concurrency > 1 (v0.2)
- PendingDecision modal (v0.3)
- Phase gate approval modal / "chat before deciding" (v0.3)
- Edit Blueprint direct-edit (v0.3)
- Redesign composer button (v0.3)
- Node pause / resume / restart (v0.3)
- Observability panel, cost meter (v0.4)

---

## Branch setup

Slice 4 starts on `nikrabaev/weave` with the `weave-v0.1-slice-3` tag at HEAD (`7c747a34`). Before Task 1:

```bash
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git branch --show-current               # must be `nikrabaev/weave`
git tag --list weave-v0.1-slice-3       # must list the tag
git merge-base --is-ancestor weave-v0.1-slice-3 HEAD \
  && echo "Slice 3 tag reachable ✓" \
  || echo "Slice 3 tag not reachable — STOP"
git log --oneline HEAD~3..HEAD
```

At slice close, tag the final commit `weave-v0.1-slice-4` on `nikrabaev/weave`. No merge to main.

---

## Pre-flight HEAD check protocol

Every implementer subagent runs this verbatim. Controller fills `<EXPECTED_SHA_AND_TITLE_1..3>` from the task sequence.

```
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

Baseline test counts (frozen at Slice 3 close):
- Contracts: 8 test files, 134 tests passing.
- Server: 971 passing, 7 failing (pre-existing GitManager env; may surface as 2–7 due to real-git flakiness — re-run once if count > 7), 4 skipped.
- Web (browser mode): report pre/post counts — baseline varies by machine. Flakiness in browser tests is common; re-run once before reporting a failure.
```

---

## Formatting + lint discipline (carry-over from Slice 3)

- **Never** run bare `bun fmt` — it reformats `docs/` markdown. Always pass specific files.
- **Never** commit `docs/` reformats from a code task. `git checkout -- docs/` before committing if necessary.
- `bun typecheck` must pass clean. Pre-existing `effect(preferSchemaOverJson)` / `effect(unnecessaryFailYieldableError)` messages in `scripts/generate.ts`, `weaveDecider.ts:214`, and `effect-codex-app-server/` are not errors — ignore.
- `bun lint` must remain at 0 errors. Web warnings count may grow by a handful — flag but don't block.

---

## Open design questions (flagged for reviewer / user)

Surfacing these so the user can redirect before Task 1 lands. Implementers should treat the resolutions below as tentative.

1. **Store primitive: Zustand slice vs. Effect Atom store.** Spec §4.1 names `weaveStore.ts` as "Effect Atom store". The existing web app uses Zustand (`apps/web/src/store.ts:1-95`). Introducing an Effect-Atom-based store mid-slice adds mental overhead without a concrete benefit for v0.1. **Plan uses Zustand for consistency**; if the user prefers Effect Atom, swap in a single task at the start.

2. **Shell-summary fields.** `OrchestrationWeaveRunShell` carries the minimum sidebar needs: `id, projectId, title, status, createdAt, updatedAt`, plus counts (`pendingCount, readyCount, runningCount, verifiedCount, failedCount`). Does not include the full Blueprint — detail fetch happens via `subscribeWeaveRun`. Open to review.

3. **`/weave` parsing.** Adding `"weave"` as a third literal in `parseStandaloneComposerSlashCommand` (alongside `"plan"`, `"default"`) is the minimum-diff path. A proper slash-command registry is a larger refactor deferred to a separate task / followup.

4. **Route hierarchy.** Spec wants `_weave.$environmentId.$weaveRunId.tsx`. TanStack Router uses `_` to denote layout groups. **Plan adopts the spec's literal pathname** but confirms the generated tree cooperates (if not, fall back to `_chat.$environmentId.weave.$weaveRunId.tsx`).

5. **Desktop-only "Open worktree" button.** Scope-limited in v0.1 per spec. **Plan renders it conditionally** based on `import.meta.env.TAURI` or an equivalent runtime gate; if the gate is absent, falls back to a disabled button with a tooltip.

If the user disputes any of the above before Task 1, re-open this section and amend.

---

## File structure at slice close

New:

```
apps/web/src/
  routes/
    _weave.$environmentId.$weaveRunId.tsx              — top-level route
    _weave.$environmentId.$weaveRunId.node.$nodeId.tsx — node drill-down
  components/weave/
    WeaveView.tsx                  — three-pane shell
    WeaveIntakeView.tsx            — compiling / empty state
    WeaveBlueprintList.tsx         — phase-grouped node list
    WeaveNodeCard.tsx              — per-node row
    WeaveInspector.tsx             — right panel embedding ChatView
    WeaveExecutionHeader.tsx       — counters + concurrency slider
    WeaveRunSidebarItem.tsx        — sidebar row
    WeaveCreatedMarker.tsx         — parent-chat marker line
    WeaveApproveCallout.tsx        — 4-tile "Approve & run" banner (see Task 14)
    WeaveCompletionBanner.tsx      — "Weave complete" banner (see Task 16)
  weave/
    weaveStore.ts                  — Zustand slice + selectors
    weaveRouteSearch.ts            — route search params
    weaveThreadSnapshot.ts         — markdown snapshot helper
```

Modified:

```
packages/contracts/src/orchestration.ts
apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
apps/server/src/ws.ts
apps/web/src/rpc/wsRpcClient.ts
apps/web/src/environments/runtime/service.ts
apps/web/src/store.ts
apps/web/src/composer-logic.ts
apps/web/src/components/chat/ChatComposer.tsx
apps/web/src/components/chat/ComposerCommandMenu.tsx
apps/web/src/components/Sidebar.tsx
apps/web/src/components/ChatView.tsx
```

Test deliverables (spec §4.9 DoD):

- Unit/browser tests for: `/weave` command dispatch, blueprint list render, inspector opens child thread chat, counters update live, completion banner appears.
- Existing t3code tests remain green. The 7 pre-existing GitManager env failures may surface; count should not increase.
- `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` all pass.

---

## Task 1: Contracts — extend `OrchestrationShellSnapshot` with weave-run summaries

**Files:**
- Modify: `packages/contracts/src/orchestration.ts` — add `OrchestrationWeaveRunShell` + extend `OrchestrationShellSnapshot` + extend `OrchestrationShellStreamEvent`.
- Modify: `packages/contracts/src/orchestration.test.ts` — add round-trip tests for the new shapes.
- Modify: `packages/contracts/src/index.ts` — confirm wildcard re-export covers new symbols (likely already does).

**Pre-flight HEAD expectation:** top-of-chain at `7c747a34 test(server): end-to-end Weave Run with 3-node Blueprint via stub provider`.

**Rationale:** The sidebar needs enough data to render a `WeaveRunSidebarItem` (title, status, progress counters) without paying for the full `WeaveRunProjection` (which includes `currentBlueprint`, `childThreads`, etc.). `OrchestrationWeaveRunShell` is the summary shape; full detail ships via the Task 2 `subscribeWeaveRun` RPC.

- [ ] **Step 1.1: Add `OrchestrationWeaveRunShell`.**

After `OrchestrationThreadShell` (near line 389 — grep `export type OrchestrationThreadShell`), add:

```ts
// OrchestrationWeaveRunShell — summary of a weave run for sidebar rendering.
// Full projection (including currentBlueprint + childThreads) is fetched
// separately via `subscribeWeaveRun`. Summary is keyed by id and refreshed
// whenever any weave.* event lands on that run.
export const OrchestrationWeaveRunShell = Schema.Struct({
  id: WeaveRunId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  status: WeaveRunStatus,
  pendingCount: NonNegativeInt,
  readyCount: NonNegativeInt,
  runningCount: NonNegativeInt,
  verifiedCount: NonNegativeInt,
  failedCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationWeaveRunShell = typeof OrchestrationWeaveRunShell.Type;
```

Import `WeaveRunId`, `WeaveRunStatus` from the same file or from `./weave.ts` (grep for existing imports of `WeaveRunId` — they already exist at line ~1013).

- [ ] **Step 1.2: Extend `OrchestrationShellSnapshot`.**

In the existing `OrchestrationShellSnapshot` (line ~396), add `weaveRuns`:

```ts
export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  weaveRuns: Schema.Array(OrchestrationWeaveRunShell),
  updatedAt: IsoDateTime,
});
```

- [ ] **Step 1.3: Extend `OrchestrationShellStreamEvent`.**

Add two variants to the existing union (line ~404):

```ts
  Schema.Struct({
    kind: Schema.Literal("weave-run-upserted"),
    sequence: NonNegativeInt,
    weaveRun: OrchestrationWeaveRunShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("weave-run-removed"),
    sequence: NonNegativeInt,
    weaveRunId: WeaveRunId,
  }),
```

- [ ] **Step 1.4: Test — round-trip decode.**

In `packages/contracts/src/orchestration.test.ts`, add a describe block:

```ts
describe("OrchestrationWeaveRunShell", () => {
  it("decodes a summary round-trip", () => {
    const decoded = Schema.decodeSync(OrchestrationWeaveRunShell)({
      id: "run-1",
      projectId: "proj-1",
      title: "Ship login",
      status: "reviewing",
      pendingCount: 3,
      readyCount: 0,
      runningCount: 0,
      verifiedCount: 0,
      failedCount: 0,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(decoded.status).toBe("reviewing");
    expect(decoded.pendingCount).toBe(3);
  });
});

describe("OrchestrationShellSnapshot", () => {
  it("decodes with empty weaveRuns", () => {
    const decoded = Schema.decodeSync(OrchestrationShellSnapshot)({
      snapshotSequence: 0,
      projects: [],
      threads: [],
      weaveRuns: [],
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(decoded.weaveRuns).toEqual([]);
  });
});

describe("OrchestrationShellStreamEvent — weave variants", () => {
  it("decodes weave-run-upserted", () => {
    const decoded = Schema.decodeSync(OrchestrationShellStreamEvent)({
      kind: "weave-run-upserted",
      sequence: 1,
      weaveRun: {
        id: "run-1",
        projectId: "proj-1",
        title: "Ship",
        status: "draft",
        pendingCount: 0,
        readyCount: 0,
        runningCount: 0,
        verifiedCount: 0,
        failedCount: 0,
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z",
      },
    });
    expect(decoded.kind).toBe("weave-run-upserted");
  });

  it("decodes weave-run-removed", () => {
    const decoded = Schema.decodeSync(OrchestrationShellStreamEvent)({
      kind: "weave-run-removed",
      sequence: 2,
      weaveRunId: "run-1",
    });
    expect(decoded.kind).toBe("weave-run-removed");
  });
});
```

- [ ] **Step 1.5: Typecheck, format, test, commit.**

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
bun fmt packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
bun typecheck
cd packages/contracts && bun run test
cd ../../apps/server && bun run test

git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(contracts): add OrchestrationWeaveRunShell + shell stream variants"
```

Expected contracts test delta: +4. Server test count unchanged.

---

## Task 2: RPC — `subscribeWeaveRun(weaveRunId)` method

**Files:**
- Modify: `packages/contracts/src/orchestration.ts` — add `ORCHESTRATION_WS_METHODS.subscribeWeaveRun`, `OrchestrationSubscribeWeaveRunInput`, `OrchestrationWeaveRunDetailSnapshot`, `OrchestrationWeaveRunDetailEvent`, `OrchestrationWeaveRunStreamItem`.
- Modify: `apps/server/src/ws.ts` — add the handler.

**Pre-flight HEAD expectation:** top-of-chain is Task 1's commit.

**Design:** mirror `subscribeThread` (which exists at ws.ts:696 per Slice 3 exploration). Snapshot returns the full `WeaveRunProjection` for the requested run; stream then sends every weave.* domain event for that run as it arrives.

- [ ] **Step 2.1: Contract shapes.**

In `packages/contracts/src/orchestration.ts`, after the `OrchestrationSubscribeThreadInput` block (line ~437):

```ts
export const OrchestrationSubscribeWeaveRunInput = Schema.Struct({
  weaveRunId: WeaveRunId,
});
export type OrchestrationSubscribeWeaveRunInput =
  typeof OrchestrationSubscribeWeaveRunInput.Type;

export const OrchestrationWeaveRunDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  weaveRun: WeaveRunProjectionSchema,  // from ./weave.ts — imported at top of orchestration.ts
});
export type OrchestrationWeaveRunDetailSnapshot =
  typeof OrchestrationWeaveRunDetailSnapshot.Type;

export const OrchestrationWeaveRunDetailEvent = Schema.Struct({
  kind: Schema.Literal("event"),
  event: OrchestrationEvent,  // narrowed to weave.* types by type predicate at consume site
});
export type OrchestrationWeaveRunDetailEvent =
  typeof OrchestrationWeaveRunDetailEvent.Type;

export const OrchestrationWeaveRunStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationWeaveRunDetailSnapshot,
  }),
  OrchestrationWeaveRunDetailEvent,
]);
export type OrchestrationWeaveRunStreamItem =
  typeof OrchestrationWeaveRunStreamItem.Type;
```

Then in `ORCHESTRATION_WS_METHODS` (line ~46):

```ts
  subscribeWeaveRun: "orchestration.subscribeWeaveRun",
```

And in the RPC methods map (line ~1304, alongside `subscribeShell` / `subscribeThread`):

```ts
  subscribeWeaveRun: {
    input: OrchestrationSubscribeWeaveRunInput,
    output: OrchestrationWeaveRunStreamItem,
  },
```

`WeaveRunProjectionSchema` is already exported from `packages/contracts/src/weave.ts` (Slice 3 Task 3 landed it). Import it at the top of `orchestration.ts` if not already imported.

- [ ] **Step 2.2: Server handler.**

In `apps/server/src/ws.ts`, next to the existing `subscribeThread` handler (line ~696), add:

```ts
[ORCHESTRATION_WS_METHODS.subscribeWeaveRun]: (input) =>
  observeRpcEffect(
    ORCHESTRATION_WS_METHODS.subscribeWeaveRun,
    Effect.gen(function* () {
      const weaveEngine = yield* WeaveEngineService;
      const engine = yield* OrchestrationEngineService;

      return Stream.asyncPush<OrchestrationWeaveRunStreamItem>((emit) =>
        Effect.gen(function* () {
          // Emit snapshot first.
          const snapshot = yield* weaveEngine.getWeaveRun(input.weaveRunId);
          if (snapshot !== null) {
            const readModel = yield* engine.getReadModel();
            yield* emit.single({
              kind: "snapshot",
              snapshot: {
                snapshotSequence: readModel.snapshotSequence,
                weaveRun: snapshot,
              },
            });
          }
          // Then stream matching events.
          yield* Stream.runForEach(weaveEngine.streamWeaveEvents, (event) => {
            if (event.payload.weaveRunId !== input.weaveRunId) return Effect.void;
            return emit.single({ kind: "event", event });
          });
        }),
      );
    }),
  ),
```

Inspect the existing `subscribeThread` handler for the exact `Stream.asyncPush` + emit pattern in this codebase — match verbatim. If the repo uses `Stream.fromPubSub` + a shutdown mechanism, follow that.

- [ ] **Step 2.3: Server handler test.**

Add to `apps/server/src/ws.weave.test.ts` (created in Slice 3 Task 11):

```ts
it("subscribeWeaveRun emits snapshot then subsequent events", async () => {
  // Boot engine with WeaveEngineLive.
  // Dispatch weave.create.
  // Call subscribeWeaveRun(runId) — first pull should be a snapshot kind
  //   with weaveRun.run.status === "draft".
  // Dispatch another weave command (e.g. weave.blueprint.compile via the planner)
  //   or synthesize via persistPlannerEvent — stream should emit an event kind.
});
```

Use the existing test harness pattern. Full implementation is straightforward once you have the subscribe handler.

- [ ] **Step 2.4: Typecheck, test, commit.**

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
bun fmt packages/contracts/src/orchestration.ts apps/server/src/ws.ts apps/server/src/ws.weave.test.ts
bun typecheck
cd packages/contracts && bun run test
cd ../../apps/server && bun run test

git add packages/contracts/src/orchestration.ts apps/server/src/ws.ts apps/server/src/ws.weave.test.ts
git commit -m "feat(server): add subscribeWeaveRun RPC + handler"
```

Expected contracts delta: +0–1 tests. Server delta: +1 test.

---

## Task 3: Server — populate `weaveRuns` in shell snapshot + stream events

**Files:**
- Modify: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — build `OrchestrationWeaveRunShell[]` from `readModel.weaveRuns` when building a shell snapshot.
- Modify: the shell-stream producer (grep for `OrchestrationShellStreamEvent` in `apps/server/src/` — likely in a `ShellStreamService.ts` or directly inside `ws.ts`) — emit `weave-run-upserted` / `weave-run-removed` on weave events.
- Modify: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts` if it exists, else add one — assert the shell snapshot includes a summary after a `weave.create`.

**Pre-flight HEAD expectation:** top-of-chain is Task 2's commit.

- [ ] **Step 3.1: Inspect the existing shell snapshot builder.**

```
grep -n "OrchestrationShellSnapshot" apps/server/src/
grep -rn "weave-run-upserted\|thread-upserted" apps/server/src/
```

Identify the function that produces `OrchestrationShellSnapshot`. Currently it builds `{ snapshotSequence, projects, threads, updatedAt }`. Extend it to also build `weaveRuns`.

- [ ] **Step 3.2: Summary builder helper.**

Add a pure helper (likely in the same file):

```ts
function buildWeaveRunShell(
  projection: WeaveRunProjection,
): OrchestrationWeaveRunShell {
  let pendingCount = 0, readyCount = 0, runningCount = 0, verifiedCount = 0, failedCount = 0;
  for (const status of projection.nodeStatuses.values()) {
    switch (status) {
      case "pending":  pendingCount++;  break;
      case "ready":    readyCount++;    break;
      case "running":  runningCount++;  break;
      case "verified": verifiedCount++; break;
      case "failed":   failedCount++;   break;
    }
  }
  return {
    id: projection.run.id,
    projectId: projection.run.projectId,
    title: projection.run.title,
    status: projection.run.status,
    pendingCount, readyCount, runningCount, verifiedCount, failedCount,
    createdAt: projection.run.createdAt,
    updatedAt: projection.run.createdAt,  // v0.1: run has no updatedAt — use createdAt or latest event occurredAt
  };
}
```

In the snapshot builder:

```ts
const weaveRuns = Array.from(readModel.weaveRuns.values()).map(buildWeaveRunShell);
return { snapshotSequence, projects, threads, weaveRuns, updatedAt };
```

- [ ] **Step 3.3: Shell-stream emission.**

Locate where `thread-upserted` and `project-upserted` are emitted (grep). Add a sibling branch for weave events:

```ts
if (event.aggregateKind === "weave") {
  const runId = event.payload.weaveRunId;
  if (event.type === "weave.exited" && /* also on terminal statuses — check projector */ false) {
    // For v0.1, don't remove — just upsert with status=aborted/complete/failed.
  }
  const projection = readModel.weaveRuns.get(runId);
  if (projection === undefined) return Effect.void;
  return emit({
    kind: "weave-run-upserted",
    sequence: event.sequence,
    weaveRun: buildWeaveRunShell(projection),
  });
}
```

Never emit `weave-run-removed` in v0.1 (runs don't get deleted). The variant exists for future use.

- [ ] **Step 3.4: Test — shell snapshot includes weave runs.**

In an appropriate `*.test.ts` (likely `ProjectionSnapshotQuery.test.ts` or a server integration test), add:

```ts
it("shell snapshot includes weave run summaries", async () => {
  // Boot engine with WeaveEngineLive.
  // Dispatch weave.create.
  // Build shell snapshot via ProjectionSnapshotQuery.getShellSnapshot() (or equivalent).
  // Assert snapshot.weaveRuns.length === 1 and .status === "draft".
});
```

- [ ] **Step 3.5: Format, typecheck, test, commit.**

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
bun fmt <touched files>
bun typecheck
cd apps/server && bun run test

git add apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts <any stream-service file> <test file>
git commit -m "feat(server): emit weave run summaries in shell snapshot + stream"
```

Expected server test delta: +1–2.

---

## Task 4: Client RPC — wire `subscribeWeaveRun` into `wsRpcClient`

**Files:**
- Modify: `apps/web/src/rpc/wsRpcClient.ts` — add the method to the client surface.
- Modify: `apps/web/src/environments/runtime/service.ts` — add `attachWeaveRunDetailSubscription` mirroring `attachThreadDetailSubscription`.

**Pre-flight HEAD expectation:** top-of-chain is Task 3's commit.

- [ ] **Step 4.1: Add `subscribeWeaveRun` to the client type + runtime.**

In `apps/web/src/rpc/wsRpcClient.ts` at ~line 118 (inside the `orchestration:` namespace):

```ts
subscribeWeaveRun: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeWeaveRun>;
```

Hook the runtime dispatch — mirror how `subscribeThread` is wired at ~line 200+.

- [ ] **Step 4.2: Add ref-counted subscription helper.**

In `apps/web/src/environments/runtime/service.ts`, mirror `attachThreadDetailSubscription` (line ~168) for weave runs. Key changes:

```ts
interface WeaveRunDetailSubscriptionEntry {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  refCount: number;
  unsubscribe: () => void;
  unsubscribeConnectionListener: (() => void) | null;
  lastAccessedAt: number;
}

function attachWeaveRunDetailSubscription(entry: WeaveRunDetailSubscriptionEntry): boolean {
  // same shape as attachThreadDetailSubscription, calling connection.client.orchestration.subscribeWeaveRun
  // with a callback that on snapshot calls syncServerWeaveRunDetail(...) and on event calls applyEnvironmentWeaveRunDetailEvent(...)
}
```

Eviction rule: drop the subscription when `refCount === 0` AND `run.status ∈ {"complete", "aborted", "failed"}` (parallel to `isNonIdleThreadDetailSubscription`).

Expose a public `useWeaveRunDetailSubscription(environmentId, weaveRunId)` hook similar to the thread hook for component consumption.

- [ ] **Step 4.3: Format, typecheck, commit.**

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
bun fmt apps/web/src/rpc/wsRpcClient.ts apps/web/src/environments/runtime/service.ts
bun typecheck

git add apps/web/src/rpc/wsRpcClient.ts apps/web/src/environments/runtime/service.ts
git commit -m "feat(web): wire subscribeWeaveRun client RPC + ref-counted subscription"
```

No test delta yet — tests land with the store slice in Task 5.

---

## Task 5: Client store — `weaveRunsById` + `weaveRunDetailById` slices

**Files:**
- Modify: `apps/web/src/store.ts` — extend `EnvironmentState` and selectors.
- Modify: `apps/web/src/orchestrationEventEffects.ts` — add weave event effect cases (noop for v0.1, but route them).
- Create: `apps/web/src/weave/weaveStore.ts` — selectors + hooks (the store-facing surface — state still lives in the main Zustand store).
- Modify: `apps/web/src/components/ChatView.browser.tsx` + `KeybindingsToast.browser.tsx` — update shell-snapshot fixtures with `weaveRuns: []`.

**Pre-flight HEAD expectation:** top-of-chain is Task 4's commit.

- [ ] **Step 5.1: Extend `EnvironmentState`.**

In `apps/web/src/store.ts` (line ~41-95 — grep for `interface EnvironmentState`), add:

```ts
weaveRunsById: Record<WeaveRunId, OrchestrationWeaveRunShell>;
weaveRunDetailById: Record<WeaveRunId, WeaveRunProjection>;
```

Import both types from `@t3tools/contracts`.

Update all `EnvironmentState` constructors / `createEmptyEnvironmentState` helpers to seed both as `{}`.

- [ ] **Step 5.2: Wire shell events.**

In the shell-event reducer (grep for where `thread-upserted` is applied), add:

```ts
if (event.kind === "weave-run-upserted") {
  return {
    ...envState,
    weaveRunsById: { ...envState.weaveRunsById, [event.weaveRun.id]: event.weaveRun },
  };
}
if (event.kind === "weave-run-removed") {
  const { [event.weaveRunId]: _, ...rest } = envState.weaveRunsById;
  return { ...envState, weaveRunsById: rest };
}
```

Also sync initial snapshots: in the snapshot-sync function, copy `snapshot.weaveRuns` into `weaveRunsById` keyed by id.

- [ ] **Step 5.3: Wire per-run detail events.**

Add a `syncServerWeaveRunDetail(snapshot: OrchestrationWeaveRunDetailSnapshot, environmentId: EnvironmentId)` and `applyEnvironmentWeaveRunDetailEvent(event: OrchestrationEvent, environmentId: EnvironmentId)` — the latter narrows by `event.type.startsWith("weave.")` and updates `weaveRunDetailById[runId]` via a local re-projection.

**Simplification:** the client can re-run `projectWeaveEvent` from `@t3tools/contracts/weave` IF we export a pure client-side version. For v0.1, the simpler approach is: on every weave event, re-request the snapshot via `subscribeWeaveRun`'s inherent "next item is a snapshot if subscription reconnects" behavior, OR store the events and reduce on read. **Recommended v0.1 approach:** export `projectWeaveEvent` as a pure client-safe function from `packages/contracts/src/weave.ts` (or from a new `weaveProjector.ts` sibling), then apply it in the client.

If exposing the projector proves too invasive (server-side today), fall back to: re-subscribe on every received event is expensive; instead, patch specific fields for each event type (e.g., `weave.node-verified` updates `nodeStatuses`). Document this shortcut.

- [ ] **Step 5.4: `weave/weaveStore.ts` — selectors + hooks.**

Create `apps/web/src/weave/weaveStore.ts`:

```ts
import { useStore } from "../store";
import type { EnvironmentId, WeaveRunId } from "@t3tools/contracts";

export function useWeaveRunsForProject(environmentId: EnvironmentId, projectId: ProjectId) {
  return useStore((state) =>
    Object.values(state.environments[environmentId]?.weaveRunsById ?? {}).filter(
      (run) => run.projectId === projectId,
    ),
  );
}

export function useWeaveRunShell(environmentId: EnvironmentId, weaveRunId: WeaveRunId) {
  return useStore(
    (state) => state.environments[environmentId]?.weaveRunsById[weaveRunId] ?? null,
  );
}

export function useWeaveRunDetail(environmentId: EnvironmentId, weaveRunId: WeaveRunId) {
  return useStore(
    (state) => state.environments[environmentId]?.weaveRunDetailById[weaveRunId] ?? null,
  );
}
```

- [ ] **Step 5.5: Fix browser-test fixtures.**

`apps/web/src/components/ChatView.browser.tsx` and `KeybindingsToast.browser.tsx` both construct shell snapshots in tests. Update each to include `weaveRuns: []`. Search-and-replace the shape.

- [ ] **Step 5.6: Commit.**

```
bun fmt apps/web/src/store.ts apps/web/src/orchestrationEventEffects.ts \
        apps/web/src/weave/weaveStore.ts \
        apps/web/src/components/ChatView.browser.tsx \
        apps/web/src/components/KeybindingsToast.browser.tsx
bun typecheck
cd apps/web && bun run test

git add apps/web/src/store.ts apps/web/src/orchestrationEventEffects.ts \
        apps/web/src/weave/weaveStore.ts \
        apps/web/src/components/ChatView.browser.tsx \
        apps/web/src/components/KeybindingsToast.browser.tsx
git commit -m "feat(web): add weave run state slices + selectors"
```

Expected web test delta: 0 (fixtures updated, no new tests yet).

---

## Task 6: Routes — `_weave.$environmentId.$weaveRunId.tsx` + search params

**Files:**
- Create: `apps/web/src/weave/weaveRouteSearch.ts` — search param schema.
- Create: `apps/web/src/routes/_weave.$environmentId.$weaveRunId.tsx`.
- Create: `apps/web/src/routes/_weave.$environmentId.$weaveRunId.node.$nodeId.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 5's commit.

- [ ] **Step 6.1: Search params helper.**

Create `apps/web/src/weave/weaveRouteSearch.ts`:

```ts
import { Schema } from "effect";

// v0.1 search params for the weave run view. Inspector-open-to-node-id is carried in the nested
// /node/$nodeId route, not in search — but keep a `tab` param reserved for future drill-downs.
export const WeaveRouteSearchSchema = Schema.Struct({
  // Reserved. v0.1 has no search params; schema is for forward compatibility.
});

export type WeaveRouteSearch = typeof WeaveRouteSearchSchema.Type;
```

- [ ] **Step 6.2: Top-level route.**

Create `apps/web/src/routes/_weave.$environmentId.$weaveRunId.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { WeaveView } from "../components/weave/WeaveView";
import { WeaveRouteSearchSchema } from "../weave/weaveRouteSearch";

export const Route = createFileRoute("/_weave/$environmentId/$weaveRunId")({
  validateSearch: WeaveRouteSearchSchema,
  component: WeaveRouteComponent,
});

function WeaveRouteComponent() {
  const { environmentId, weaveRunId } = useParams({
    from: "/_weave/$environmentId/$weaveRunId",
  });
  return <WeaveView environmentId={environmentId} weaveRunId={weaveRunId} />;
}
```

Verify the exact TanStack Router API against the existing `_chat.$environmentId.$threadId.tsx` — copy the pattern verbatim.

- [ ] **Step 6.3: Nested node route.**

Create `apps/web/src/routes/_weave.$environmentId.$weaveRunId.node.$nodeId.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { WeaveView } from "../components/weave/WeaveView";

export const Route = createFileRoute("/_weave/$environmentId/$weaveRunId/node/$nodeId")({
  component: WeaveRouteNodeComponent,
});

function WeaveRouteNodeComponent() {
  const { environmentId, weaveRunId, nodeId } = useParams({
    from: "/_weave/$environmentId/$weaveRunId/node/$nodeId",
  });
  return <WeaveView environmentId={environmentId} weaveRunId={weaveRunId} openNodeId={nodeId} />;
}
```

The `WeaveView` component (Task 7) accepts an optional `openNodeId` prop.

- [ ] **Step 6.4: Regenerate the route tree.**

Run `bun run routes:generate` or the equivalent — check `apps/web/package.json` scripts for the TanStack Router codegen command. If the project uses auto-watch during dev, it may pick up the file automatically.

- [ ] **Step 6.5: Commit.**

```
bun fmt apps/web/src/weave/weaveRouteSearch.ts \
        apps/web/src/routes/_weave.$environmentId.$weaveRunId.tsx \
        apps/web/src/routes/_weave.$environmentId.$weaveRunId.node.$nodeId.tsx
bun typecheck

git add apps/web/src/weave/weaveRouteSearch.ts apps/web/src/routes/_weave.*.tsx \
        apps/web/src/routeTree.gen.ts  # if regenerated
git commit -m "feat(web): add weave run route + node drill-down route"
```

---

## Task 7: `WeaveView.tsx` — three-pane shell + status-dispatch

**Files:**
- Create: `apps/web/src/components/weave/WeaveView.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 6's commit.

- [ ] **Step 7.1: Scaffold the shell.**

```tsx
// apps/web/src/components/weave/WeaveView.tsx
import type { EnvironmentId, WeaveRunId, WeaveNodeId } from "@t3tools/contracts";
import { useWeaveRunShell, useWeaveRunDetail } from "../../weave/weaveStore";
import { useWeaveRunDetailSubscription } from "../../environments/runtime/service";
import { WeaveIntakeView } from "./WeaveIntakeView";
import { WeaveBlueprintList } from "./WeaveBlueprintList";
import { WeaveInspector } from "./WeaveInspector";
import { WeaveExecutionHeader } from "./WeaveExecutionHeader";
import { WeaveApproveCallout } from "./WeaveApproveCallout";
import { WeaveCompletionBanner } from "./WeaveCompletionBanner";

export interface WeaveViewProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly openNodeId?: WeaveNodeId;
}

export function WeaveView(props: WeaveViewProps) {
  useWeaveRunDetailSubscription(props.environmentId, props.weaveRunId);
  const shell = useWeaveRunShell(props.environmentId, props.weaveRunId);
  const detail = useWeaveRunDetail(props.environmentId, props.weaveRunId);

  if (!shell) return <div className="p-8 text-muted-foreground">Loading weave run…</div>;

  return (
    <div className="grid grid-cols-[320px_1fr_400px] h-full">
      {/* Left: chat sidebar — placeholder in v0.1 */}
      <aside className="border-r border-border p-4">
        <div className="text-xs text-muted-foreground">Intake conversation (coming in v0.3)</div>
      </aside>

      {/* Center: canvas */}
      <main className="flex flex-col overflow-y-auto">
        <WeaveExecutionHeader shell={shell} />
        {shell.status === "complete" && <WeaveCompletionBanner environmentId={props.environmentId} weaveRunId={shell.id} />}
        {shell.status === "draft" && <WeaveIntakeView />}
        {shell.status === "reviewing" && detail?.currentBlueprint && (
          <>
            <WeaveApproveCallout
              environmentId={props.environmentId}
              weaveRunId={shell.id}
              blueprint={detail.currentBlueprint}
            />
            <WeaveBlueprintList detail={detail} openNodeId={props.openNodeId} />
          </>
        )}
        {(shell.status === "running" || shell.status === "complete" || shell.status === "failed" || shell.status === "aborted") && detail?.currentBlueprint && (
          <WeaveBlueprintList detail={detail} openNodeId={props.openNodeId} />
        )}
      </main>

      {/* Right: inspector */}
      <aside className="border-l border-border">
        {props.openNodeId && detail && (
          <WeaveInspector
            environmentId={props.environmentId}
            weaveRunDetail={detail}
            openNodeId={props.openNodeId}
          />
        )}
      </aside>
    </div>
  );
}
```

Match the repo's className + import style (check a neighboring component for precedent).

- [ ] **Step 7.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveView.tsx
bun typecheck

git add apps/web/src/components/weave/WeaveView.tsx
git commit -m "feat(web): add WeaveView three-pane shell"
```

Typecheck will fail because the child components don't exist yet — either stub them as `() => null` placeholders in the shell file temporarily, OR commit this task AFTER Tasks 8–14. Controller: execute Tasks 8–14 first if strict ordering matters.

**Alternative ordering note:** Tasks 8–14 (individual components) can precede Task 7 (shell). Dispatch accordingly — the plan lists Task 7 first for narrative clarity only.

---

## Task 8: `WeaveIntakeView.tsx` — compiling placeholder

**Files:**
- Create: `apps/web/src/components/weave/WeaveIntakeView.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 7's commit.

- [ ] **Step 8.1: Component.**

```tsx
import { Spinner } from "../ui/spinner";  // or the repo's equivalent

export function WeaveIntakeView() {
  return (
    <div className="flex flex-col items-center justify-center p-16 gap-4">
      <Spinner className="h-8 w-8" />
      <div className="text-lg font-medium">Compiling plan…</div>
      <div className="text-sm text-muted-foreground">
        The planner is drafting your Blueprint. This usually takes 10–30 seconds.
      </div>
    </div>
  );
}
```

If the repo has no `Spinner`, use `<div className="animate-spin ..." />` with Tailwind or `<Loader2 />` from `lucide-react` if that icon set is already used.

- [ ] **Step 8.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveIntakeView.tsx
git add apps/web/src/components/weave/WeaveIntakeView.tsx
git commit -m "feat(web): add WeaveIntakeView placeholder"
```

---

## Task 9: `WeaveNodeCard.tsx` — per-node row

**Files:**
- Create: `apps/web/src/components/weave/WeaveNodeCard.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 8's commit.

- [ ] **Step 9.1: Component.**

```tsx
import type { WeaveNode, WeaveNodeStatus } from "@t3tools/contracts";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

const STATUS_COLOR: Record<WeaveNodeStatus, string> = {
  pending:  "bg-muted text-muted-foreground",
  ready:    "bg-blue-500/20 text-blue-700",
  running:  "bg-amber-500/20 text-amber-700",
  verified: "bg-green-500/20 text-green-700",
  failed:   "bg-red-500/20 text-red-700",
};

const STATUS_ICON: Record<WeaveNodeStatus, string> = {
  pending:  "○",
  ready:    "●",
  running:  "⏳",
  verified: "✓",
  failed:   "✗",
};

export interface WeaveNodeCardProps {
  readonly node: WeaveNode;
  readonly status: WeaveNodeStatus;
  readonly dependsOnStatuses: ReadonlyMap<string, WeaveNodeStatus>;
  readonly selected: boolean;
  readonly onClick: () => void;
}

export function WeaveNodeCard({ node, status, dependsOnStatuses, selected, onClick }: WeaveNodeCardProps) {
  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 border-l-4 text-left",
        selected ? "border-cyan-500 bg-cyan-500/5" : "border-transparent hover:bg-muted/50",
      )}
      onClick={onClick}
    >
      <div className={cn("w-6 h-6 flex items-center justify-center rounded text-xs", STATUS_COLOR[status])}>
        {STATUS_ICON[status]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{node.title}</div>
        {node.dependsOn.length > 0 && (
          <div className="text-xs text-muted-foreground flex gap-1 flex-wrap mt-1">
            {node.dependsOn.map((dep) => (
              <Badge key={dep} variant="outline" className="text-[10px]">
                {dep} {STATUS_ICON[dependsOnStatuses.get(dep) ?? "pending"]}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
```

Adjust the import path for `Badge`, `cn`, and `WeaveNode`/`WeaveNodeStatus` to match the repo.

- [ ] **Step 9.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveNodeCard.tsx
git add apps/web/src/components/weave/WeaveNodeCard.tsx
git commit -m "feat(web): add WeaveNodeCard row"
```

---

## Task 10: `WeaveBlueprintList.tsx` — phase-grouped list

**Files:**
- Create: `apps/web/src/components/weave/WeaveBlueprintList.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 9's commit.

- [ ] **Step 10.1: Component.**

```tsx
import { useNavigate, useParams } from "@tanstack/react-router";
import type { WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";
import { WeaveNodeCard } from "./WeaveNodeCard";

export interface WeaveBlueprintListProps {
  readonly detail: WeaveRunProjection;
  readonly openNodeId?: WeaveNodeId;
}

export function WeaveBlueprintList({ detail, openNodeId }: WeaveBlueprintListProps) {
  const navigate = useNavigate();
  const { environmentId, weaveRunId } = useParams({ strict: false });
  const blueprint = detail.currentBlueprint!;

  // Group nodes by phase, preserving phase ordinal + node topological order.
  const phases = [...blueprint.phases].sort((a, b) => a.ordinal - b.ordinal);

  return (
    <div className="flex flex-col py-4">
      {phases.map((phase) => {
        const phaseNodes = blueprint.nodes.filter((n) => n.phaseId === phase.id);
        return (
          <section key={phase.id} className="mb-6">
            <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {phase.title}
            </h2>
            <div className="flex flex-col">
              {phaseNodes.map((node) => (
                <WeaveNodeCard
                  key={node.id}
                  node={node}
                  status={detail.nodeStatuses.get(node.id) ?? "pending"}
                  dependsOnStatuses={detail.nodeStatuses}
                  selected={openNodeId === node.id}
                  onClick={() =>
                    navigate({
                      to: "/_weave/$environmentId/$weaveRunId/node/$nodeId",
                      params: { environmentId, weaveRunId, nodeId: node.id },
                    })
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

Verify topological order within phase — if the blueprint doesn't guarantee topological order, sort `phaseNodes` by a computed level before rendering.

- [ ] **Step 10.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveBlueprintList.tsx
git add apps/web/src/components/weave/WeaveBlueprintList.tsx
git commit -m "feat(web): add WeaveBlueprintList phase-grouped view"
```

---

## Task 11: `WeaveInspector.tsx` — embedded ChatView

**Files:**
- Create: `apps/web/src/components/weave/WeaveInspector.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 10's commit.

- [ ] **Step 11.1: Component.**

```tsx
import type { EnvironmentId, WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";
import { ChatView } from "../ChatView";
import { Button } from "../ui/button";

export interface WeaveInspectorProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunDetail: WeaveRunProjection;
  readonly openNodeId: WeaveNodeId;
}

export function WeaveInspector({ environmentId, weaveRunDetail, openNodeId }: WeaveInspectorProps) {
  const childThread = weaveRunDetail.childThreads.get(openNodeId);
  if (!childThread) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        This node hasn't been dispatched yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="text-sm font-medium">Node: {openNodeId}</div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`/${environmentId}/${childThread.threadId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open thread ↗
            </a>
          </Button>
          {isDesktop() && (
            <Button variant="ghost" size="sm" onClick={() => revealInFileManager(childThread.worktreePath)}>
              Open worktree
            </Button>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        <ChatView
          environmentId={environmentId}
          threadId={childThread.threadId}
          routeKind="server"
        />
      </div>
    </div>
  );
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && "TAURI" in window;  // adjust based on desktop shell
}

function revealInFileManager(path: string): void {
  // Stub for v0.1 — desktop shell only. Web builds no-op.
  console.warn("reveal in file manager not available:", path);
}
```

Adjust `ChatView` prop types to match the actual component signature. `isDesktop` / `revealInFileManager` should be replaced with the project's actual desktop-shell detection if it already exists (search for `TAURI` or `desktop` in `apps/web/src/`).

- [ ] **Step 11.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveInspector.tsx
bun typecheck

git add apps/web/src/components/weave/WeaveInspector.tsx
git commit -m "feat(web): add WeaveInspector with embedded ChatView"
```

---

## Task 12: `WeaveExecutionHeader.tsx` — counters + locked slider

**Files:**
- Create: `apps/web/src/components/weave/WeaveExecutionHeader.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 11's commit.

- [ ] **Step 12.1: Component.**

```tsx
import type { OrchestrationWeaveRunShell } from "@t3tools/contracts";

export interface WeaveExecutionHeaderProps {
  readonly shell: OrchestrationWeaveRunShell;
}

export function WeaveExecutionHeader({ shell }: WeaveExecutionHeaderProps) {
  const total = shell.pendingCount + shell.readyCount + shell.runningCount + shell.verifiedCount + shell.failedCount;
  return (
    <header className="px-6 py-4 border-b border-border flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">{shell.title}</h1>
        <span className="text-sm text-muted-foreground">{shell.status}</span>
      </div>
      <div className="flex items-center gap-6 text-xs">
        <Stat label="Verified" value={shell.verifiedCount} color="text-green-600" />
        <Stat label="Running"  value={shell.runningCount}  color="text-amber-600" />
        <Stat label="Ready"    value={shell.readyCount}    color="text-blue-600" />
        <Stat label="Failed"   value={shell.failedCount}   color="text-red-600" />
        <Stat label="Pending"  value={shell.pendingCount}  color="text-muted-foreground" />
        <Stat label="Total"    value={total} />
        <div className="flex items-center gap-2 border-l border-border pl-6">
          <label className="text-muted-foreground">Concurrency</label>
          <input
            type="range"
            min={1}
            max={1}
            value={1}
            disabled
            className="w-24"
            aria-label="Concurrency cap (locked at 1 in v0.1)"
          />
          <span className="text-muted-foreground">1 (locked)</span>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`font-medium ${color ?? ""}`}>{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}
```

- [ ] **Step 12.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveExecutionHeader.tsx
git add apps/web/src/components/weave/WeaveExecutionHeader.tsx
git commit -m "feat(web): add WeaveExecutionHeader with counters + locked concurrency"
```

---

## Task 13: `WeaveApproveCallout.tsx` — 4-tile approve banner

**Files:**
- Create: `apps/web/src/components/weave/WeaveApproveCallout.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 12's commit.

- [ ] **Step 13.1: Component.**

```tsx
import type { Blueprint, EnvironmentId, WeaveRunId } from "@t3tools/contracts";
import { BlueprintVersion, CommandId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";  // helper created here or inline

export interface WeaveApproveCalloutProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly blueprint: Blueprint;
}

export function WeaveApproveCallout({ environmentId, weaveRunId, blueprint }: WeaveApproveCalloutProps) {
  const phaseCount = blueprint.phases.length;
  const nodeCount = blueprint.nodes.length;
  const extractionCount = blueprint.extractions?.length ?? 0;
  const estWallTime = "≈ 10–30 min";  // v0.1 placeholder per spec §4.6

  const handleApprove = async () => {
    await dispatchWeaveCommand(environmentId, {
      type: "weave.blueprint.approve",
      commandId: CommandId.make(crypto.randomUUID()),
      weaveRunId,
      blueprintVersion: BlueprintVersion.make(blueprint.version),
      concurrencyCap: 1,  // v0.1 locked
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="px-6 py-4 border-b border-border bg-cyan-500/5">
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Tile label="Phases" value={phaseCount} />
        <Tile label="Nodes" value={nodeCount} />
        <Tile label="Extractions" value={extractionCount} />
        <Tile label="Est. wall time" value={estWallTime} />
      </div>
      <div className="flex gap-3">
        <Button onClick={handleApprove} autoFocus>Approve & run (⌘↵)</Button>
        <Button variant="outline" disabled title="Direct-edit ships in v0.3">
          Edit Blueprint
        </Button>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center p-3 bg-background rounded border border-border">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
```

- [ ] **Step 13.2: `dispatchWeaveCommand` helper.**

Create `apps/web/src/weave/dispatchWeaveCommand.ts`:

```ts
import type { EnvironmentId, WeaveCommand } from "@t3tools/contracts";
import { readEnvironmentConnection } from "../environments/runtime/service";

export async function dispatchWeaveCommand(
  environmentId: EnvironmentId,
  command: WeaveCommand,
): Promise<{ sequence: number }> {
  const connection = readEnvironmentConnection(environmentId);
  if (!connection) throw new Error(`No connection for environment ${environmentId}`);
  return await connection.client.orchestration.dispatchCommand(command as never);
  // The `as never` cast may be required if `dispatchCommand`'s input is typed narrower —
  // investigate and remove if the existing dispatcher already accepts WeaveCommand.
}
```

If the existing dispatch helper (likely `sendCommand` or similar — grep `dispatchCommand` in web) already handles this, reuse it instead.

- [ ] **Step 13.3: ⌘↵ shortcut.**

Register a keyboard handler on the Callout (or at a higher level) that listens for `Cmd+Enter` / `Ctrl+Enter` and triggers `handleApprove`. Inspect the existing keybinding registration pattern (there's a `KeybindingsToast.browser.tsx` — find the central registry).

- [ ] **Step 13.4: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveApproveCallout.tsx \
        apps/web/src/weave/dispatchWeaveCommand.ts
bun typecheck

git add apps/web/src/components/weave/WeaveApproveCallout.tsx \
        apps/web/src/weave/dispatchWeaveCommand.ts
git commit -m "feat(web): add WeaveApproveCallout with approve dispatch + shortcut"
```

---

## Task 14: `WeaveCompletionBanner.tsx`

**Files:**
- Create: `apps/web/src/components/weave/WeaveCompletionBanner.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 13's commit.

- [ ] **Step 14.1: Component.**

```tsx
import type { EnvironmentId, WeaveRunId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

export interface WeaveCompletionBannerProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
}

export function WeaveCompletionBanner({ environmentId, weaveRunId }: WeaveCompletionBannerProps) {
  return (
    <div className="px-6 py-4 border-b border-border bg-green-500/10 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="text-2xl">✓</div>
        <div>
          <div className="font-semibold">Weave complete.</div>
          <div className="text-sm text-muted-foreground">All nodes verified.</div>
        </div>
      </div>
      {/* Link back to parent chat — requires tracking `parentThreadId` on the run.
          v0.1 projection includes parentThreadId; read it from detail. */}
    </div>
  );
}
```

- [ ] **Step 14.2: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveCompletionBanner.tsx
git add apps/web/src/components/weave/WeaveCompletionBanner.tsx
git commit -m "feat(web): add WeaveCompletionBanner"
```

---

## Task 15: `WeaveRunSidebarItem.tsx` + sidebar integration

**Files:**
- Create: `apps/web/src/components/weave/WeaveRunSidebarItem.tsx`.
- Modify: `apps/web/src/components/Sidebar.tsx` — render `WeaveRunSidebarItem` in each project's group.

**Pre-flight HEAD expectation:** top-of-chain is Task 14's commit.

- [ ] **Step 15.1: Sidebar item component.**

```tsx
import type { OrchestrationWeaveRunShell, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/utils";

export interface WeaveRunSidebarItemProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRun: OrchestrationWeaveRunShell;
  readonly active: boolean;
}

export function WeaveRunSidebarItem({ environmentId, weaveRun, active }: WeaveRunSidebarItemProps) {
  const total = weaveRun.pendingCount + weaveRun.readyCount + weaveRun.runningCount + weaveRun.verifiedCount + weaveRun.failedCount;
  const done = weaveRun.verifiedCount;
  return (
    <Link
      to="/_weave/$environmentId/$weaveRunId"
      params={{ environmentId, weaveRunId: weaveRun.id }}
      className={cn(
        "flex items-center gap-2 px-3 py-2 border-l-2 border-cyan-500",
        active && "bg-cyan-500/10",
      )}
    >
      <span className="text-cyan-600">◇</span>  {/* weave mark glyph */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{weaveRun.title}</div>
        <div className="text-xs text-muted-foreground flex gap-2">
          <span>{done}/{total}</span>
          {weaveRun.failedCount > 0 && <span className="text-red-600">{weaveRun.failedCount} failed</span>}
          {weaveRun.runningCount > 0 && <span className="text-amber-600">{weaveRun.runningCount} running</span>}
        </div>
        <div className="h-1 bg-muted rounded mt-1 overflow-hidden flex">
          <div className="bg-green-500" style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
          <div className="bg-red-500" style={{ width: `${(weaveRun.failedCount / Math.max(total, 1)) * 100}%` }} />
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 15.2: Sidebar integration.**

In `apps/web/src/components/Sidebar.tsx`, inside the project-scoped group rendering (grep for where threads are rendered per project), add:

```tsx
const weaveRuns = useWeaveRunsForProject(environmentId, project.id);
// ... render weaveRuns as WeaveRunSidebarItem above or below the thread list.
```

Group styling should visually distinguish weave runs from regular threads (cyan stripe already does this).

- [ ] **Step 15.3: Commit.**

```
bun fmt apps/web/src/components/weave/WeaveRunSidebarItem.tsx \
        apps/web/src/components/Sidebar.tsx
bun typecheck

git add apps/web/src/components/weave/WeaveRunSidebarItem.tsx \
        apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add WeaveRunSidebarItem + sidebar integration"
```

---

## Task 16: `/weave` slash command + `weaveThreadSnapshot.ts` + navigation

**Files:**
- Create: `apps/web/src/weave/weaveThreadSnapshot.ts`.
- Modify: `apps/web/src/composer-logic.ts` — extend `ComposerSlashCommand` union, extend `parseStandaloneComposerSlashCommand`.
- Modify: `apps/web/src/components/chat/ChatComposer.tsx` — handle `/weave` submit.
- Modify: `apps/web/src/components/chat/ComposerCommandMenu.tsx` — add menu entry.
- Create: `apps/web/src/components/weave/WeaveCreatedMarker.tsx`.
- Modify: `apps/web/src/components/ChatView.tsx` — render `WeaveCreatedMarker` for messages tagged with a weave-created event.

**Pre-flight HEAD expectation:** top-of-chain is Task 15's commit.

- [ ] **Step 16.1: Markdown snapshot helper.**

Create `apps/web/src/weave/weaveThreadSnapshot.ts`:

```ts
import type { OrchestrationMessage } from "@t3tools/contracts";

/**
 * Converts a thread's message history into a markdown transcript suitable
 * for feeding to the planner as the initial vision / context.
 *
 * Format: alternating **User:** / **Assistant:** headings, preserving
 * message text. Skips tool calls, attachments, and activity entries for v0.1.
 */
export function buildThreadMarkdownSnapshot(
  messages: ReadonlyArray<OrchestrationMessage>,
): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("## User", "", msg.text ?? "", "");
    } else if (msg.role === "assistant") {
      lines.push("## Assistant", "", msg.text ?? "", "");
    }
  }
  return lines.join("\n").trim();
}
```

Add a test at `apps/web/src/weave/weaveThreadSnapshot.test.ts` using the existing web test harness.

Adapt the `OrchestrationMessage` import to the actual message shape in the codebase — it may be nested inside the thread projection.

- [ ] **Step 16.2: Extend slash command parser.**

In `apps/web/src/composer-logic.ts`, find `ComposerSlashCommand` (line ~5 per explore). Extend:

```ts
export type ComposerSlashCommand = "plan" | "default" | "weave";
```

Find `parseStandaloneComposerSlashCommand` (line ~258). Add:

```ts
if (command === "weave") return "weave";
```

Adjust the actual switch/match shape to match the current code exactly.

- [ ] **Step 16.3: Composer submit handler.**

In `apps/web/src/components/chat/ChatComposer.tsx`, the submit-handler flow currently dispatches a turn. For `weave`:

```ts
if (parsedSlash === "weave") {
  // Build snapshot from current thread.
  const messages = selectMessagesForThread(state, threadId);
  const snapshot = buildThreadMarkdownSnapshot(messages);
  // Extract a title — first user message or a short derivation.
  const title = deriveTitleFromSnapshot(snapshot);
  // Dispatch weave.create.
  const weaveRunId = WeaveRunId.make(crypto.randomUUID());
  await dispatchWeaveCommand(environmentId, {
    type: "weave.create",
    commandId: CommandId.make(crypto.randomUUID()),
    weaveRunId,
    projectId,
    title,
    vision: snapshot,
    parentThreadId: threadId,
    snapshotContent: snapshot,
    createdAt: new Date().toISOString(),
  });
  // Wait for weave.created event (polling or subscribe — use the existing RPC subscribe for the new run).
  // Navigate.
  navigate({
    to: "/_weave/$environmentId/$weaveRunId",
    params: { environmentId, weaveRunId },
  });
  return;
}
```

Add `parentMessageId` to the command — it should be the id of the message the `/weave` was fired from (the last user message containing the `/weave` token). Store it so `WeaveCreatedMarker` can locate its anchor.

- [ ] **Step 16.4: Command menu entry.**

In `apps/web/src/components/chat/ComposerCommandMenu.tsx`, add a `ComposerCommandItem` variant for `weave`:

```ts
{ type: "slash-command", name: "weave", description: "Compile a Blueprint from this chat and run it" }
```

Slot into the grouped command items.

- [ ] **Step 16.5: `WeaveCreatedMarker.tsx`.**

```tsx
import type { EnvironmentId, WeaveRunId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

export interface WeaveCreatedMarkerProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly title: string;
}

export function WeaveCreatedMarker({ environmentId, weaveRunId, title }: WeaveCreatedMarkerProps) {
  return (
    <div className="my-4 px-4 py-2 border-y border-cyan-500/30 bg-cyan-500/5 flex items-center gap-2">
      <span className="text-cyan-600">◇</span>
      <span className="text-sm">Compiled a Weave: </span>
      <Link
        to="/_weave/$environmentId/$weaveRunId"
        params={{ environmentId, weaveRunId }}
        className="text-sm font-medium hover:underline"
      >
        {title}
      </Link>
    </div>
  );
}
```

- [ ] **Step 16.6: ChatView anchor rendering.**

In `apps/web/src/components/ChatView.tsx`, when rendering messages, detect messages that triggered a `/weave` command. Two approaches:
- **Client-side marker:** locally track `(threadId, messageId) → weaveRunId` in the store.
- **Server-side event:** the `weave.created` event carries `parentMessageId` — the thread's event stream can be checked for weave-created events referencing each message.

Use the latter — read `envState.weaveRunsById`, filter runs where `parentThreadId === threadId`, anchor each to the message whose `id === parentMessageId`. Render `<WeaveCreatedMarker>` between that message and the next one.

- [ ] **Step 16.7: Commit.**

```
bun fmt apps/web/src/weave/weaveThreadSnapshot.ts \
        apps/web/src/weave/weaveThreadSnapshot.test.ts \
        apps/web/src/composer-logic.ts \
        apps/web/src/components/chat/ChatComposer.tsx \
        apps/web/src/components/chat/ComposerCommandMenu.tsx \
        apps/web/src/components/weave/WeaveCreatedMarker.tsx \
        apps/web/src/components/ChatView.tsx
bun typecheck
cd apps/web && bun run test

git add apps/web/src/weave/weaveThreadSnapshot.ts \
        apps/web/src/weave/weaveThreadSnapshot.test.ts \
        apps/web/src/composer-logic.ts \
        apps/web/src/components/chat/ChatComposer.tsx \
        apps/web/src/components/chat/ComposerCommandMenu.tsx \
        apps/web/src/components/weave/WeaveCreatedMarker.tsx \
        apps/web/src/components/ChatView.tsx
git commit -m "feat(web): add /weave slash command, thread snapshot, marker"
```

---

## Task 17: Browser tests — `/weave` flow + blueprint list + inspector

**Files:**
- Create: `apps/web/src/components/weave/WeaveView.browser.tsx`.
- Possibly create: `apps/web/src/components/weave/WeaveBlueprintList.browser.tsx`.

**Pre-flight HEAD expectation:** top-of-chain is Task 16's commit.

- [ ] **Step 17.1: Test — `/weave` dispatches + navigates.**

In `WeaveView.browser.tsx`, use the `BrowserWsRpcHarness` pattern from `ChatView.browser.tsx`:

```tsx
it("dispatches weave.create and navigates to the weave route on /weave submit", async () => {
  // Seed a project + thread.
  // Mount ChatView for that thread.
  // Type "/weave" + Enter in the composer.
  // Assert: RPC harness received a dispatchCommand with type "weave.create".
  // Assert: router navigated to /_weave/<envId>/<newRunId>.
});
```

- [ ] **Step 17.2: Test — blueprint list renders phase-grouped with statuses.**

```tsx
it("renders blueprint list with phase headings and node statuses", async () => {
  // Seed a weave run with status "reviewing" and a 3-node blueprint.
  // Mount WeaveView.
  // Assert: phase heading visible.
  // Assert: 3 node cards visible with correct status icons.
});
```

- [ ] **Step 17.3: Test — inspector opens with child thread chat.**

```tsx
it("opens the inspector when a node card is clicked", async () => {
  // Seed a weave run with a dispatched node (childThreads populated).
  // Mount WeaveView.
  // Click the node card.
  // Assert: router URL is /_weave/.../node/<nodeId>.
  // Assert: ChatView for the child thread is visible in the inspector panel.
});
```

- [ ] **Step 17.4: Test — counters update live on events.**

```tsx
it("updates counters when a weave.node-verified event arrives", async () => {
  // Seed a running weave run.
  // Mount WeaveView.
  // Assert: verifiedCount === 0.
  // Push a weave-run-upserted event with verifiedCount === 1.
  // Assert: WeaveExecutionHeader reflects "Verified 1".
});
```

- [ ] **Step 17.5: Test — completion banner.**

```tsx
it("shows the completion banner when status becomes complete", async () => {
  // Seed a reviewing run.
  // Push upsert with status "complete".
  // Assert: banner visible.
});
```

- [ ] **Step 17.6: Commit.**

```
cd apps/web && bun run test
bun fmt apps/web/src/components/weave/WeaveView.browser.tsx

git add apps/web/src/components/weave/WeaveView.browser.tsx
git commit -m "test(web): browser tests for weave view + /weave dispatch + counters"
```

Expected web test delta: +5.

---

## Task 18: DoD gate + tag Slice 4 close

**Files:** none (validation only).

**Pre-flight HEAD expectation:** top-of-chain is Task 17's commit.

Per [spec §4.9](../../weave/v0.1-spec.md#49-definition-of-done):

- [ ] **Step 18.1: Visual smoke test.**

Start the dev server:

```
bun dev
```

In the browser (Chrome recommended for vitest browser mode parity):

1. Create a project + thread. Have a short user↔assistant conversation.
2. Type `/weave` in the composer and submit.
3. Verify the sidebar now shows a cyan-stripe Weave Run row.
4. Verify the URL navigated to `/_weave/<envId>/<runId>`.
5. Verify the intake view shows "Compiling plan…".
6. Wait for the (stub or real) planner to emit `weave.blueprint-compiled` — verify the 4-tile callout appears with Approve & run button.
7. Click Approve. Verify status transitions to "running".
8. Click a node — inspector opens with a child thread chat.
9. Wait for the run to reach "complete" — verify completion banner.
10. Click back to parent chat — verify `WeaveCreatedMarker` anchor is at the right message.

Note any issues in a report; address before tagging.

- [ ] **Step 18.2: `bun typecheck` repo-wide.**

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
bun typecheck
```

Expected: all packages clean (modulo pre-existing `effect(preferSchemaOverJson)` / `effect(unnecessaryFailYieldableError)` messages in `scripts/generate.ts`, `effect-codex-app-server/**`, and `weaveDecider.ts:214`).

- [ ] **Step 18.3: `bun run test` repo-wide.**

```
bun run test 2>&1 | tail -30
```

Expected: server ≥971 passing + 7 GitManager env failures + 4 skipped (unchanged). Contracts ≥139. Web: +5 tests from Task 17.

- [ ] **Step 18.4: `bun lint` repo-wide.**

```
bun lint
```

Expected: 0 errors. Web warning count may grow by a handful — note but don't block.

- [ ] **Step 18.5: `bun fmt` repo-wide only if needed.**

If any committed file shows formatter diff:

```
bun fmt <specific files>
# Verify no docs/ reformats
git status
git checkout -- docs/  # if reformats snuck in
git add <reformatted files>
git commit -m "chore(web): apply oxfmt"
```

- [ ] **Step 18.6: Commit trail review.**

```
git log --oneline weave-v0.1-slice-3..HEAD
```

Expected (newest first, ~18 commits):

```
[optional] chore(web): apply oxfmt
test(web): browser tests for weave view + /weave dispatch + counters
feat(web): add /weave slash command, thread snapshot, marker
feat(web): add WeaveRunSidebarItem + sidebar integration
feat(web): add WeaveCompletionBanner
feat(web): add WeaveApproveCallout with approve dispatch + shortcut
feat(web): add WeaveExecutionHeader with counters + locked concurrency
feat(web): add WeaveInspector with embedded ChatView
feat(web): add WeaveBlueprintList phase-grouped view
feat(web): add WeaveNodeCard row
feat(web): add WeaveIntakeView placeholder
feat(web): add WeaveView three-pane shell
feat(web): add weave run route + node drill-down route
feat(web): add weave run state slices + selectors
feat(web): wire subscribeWeaveRun client RPC + ref-counted subscription
feat(server): emit weave run summaries in shell snapshot + stream
feat(server): add subscribeWeaveRun RPC + handler
feat(contracts): add OrchestrationWeaveRunShell + shell stream variants
```

- [ ] **Step 18.7: Tag the slice.**

```
git tag weave-v0.1-slice-4
# optional: git push origin nikrabaev/weave weave-v0.1-slice-4
```

v0.1 is now feature-complete. No merge to `main` — see roadmap for the v0.1 → v0.2 transition plan.

---

## Self-review summary

- **Spec coverage** ([§Slice 4](../../weave/v0.1-spec.md#slice-4--web-ui-intake--list-form-blueprint--inspector)):
  - §4.1 files: all 13 new files + 8 modifications covered across Tasks 1–17. ✓
  - §4.2 `/weave` slash command: Task 16. ✓
  - §4.3 Sidebar integration: Task 15. ✓
  - §4.4 Weave view (three-pane): Task 7 + Task 10 (canvas) + Task 11 (inspector). ✓
  - §4.5 Empty / intake state: Task 8. ✓
  - §4.6 Approve flow: Task 13. ✓
  - §4.7 Execution state: Task 12 (header) + Task 9 (node card status). ✓
  - §4.8 Completion: Task 14. ✓
  - §4.9 DoD: Task 18. ✓

- **Dependencies before v0.1 ships:**
  - Planner provider integration (followup filed in Slice 3) — MUST be resolved OR Slice 4 verification must rely on the stub-provider integration test shape from Slice 3. Without a real provider driver, the intake view will stay stuck on "Compiling plan…". Flag in Task 18 smoke test.

- **Placeholder scan:** every step has concrete files + code OR explicit pointers to existing files to inspect. Task 5 Step 5.3 has a judgment call (export `projectWeaveEvent` vs. patch per-event); plan recommends the former and documents the shortcut fallback.

- **Type consistency:**
  - `OrchestrationWeaveRunShell` used identically in Tasks 1, 3, 5, 12, 15. ✓
  - `WeaveRunProjection` already contract-exported (Slice 3 Task 3). ✓
  - `WeaveNodeCardProps.dependsOnStatuses` — ReadonlyMap keyed by `WeaveNodeId`, passed from `detail.nodeStatuses`. ✓
  - `dispatchWeaveCommand` helper consumes `WeaveCommand` uniformly across Tasks 13 and 16. ✓

- **Known open questions surfaced for execution-time decisions:**
  - Effect Atom vs. Zustand for `weaveStore.ts` — plan chooses Zustand.
  - Whether to export `projectWeaveEvent` as a client-safe pure function vs. per-event patching in the store.
  - Desktop-shell detection for "Open worktree" button — runtime gate TBD.
  - TanStack Router path literal `_weave` vs. fallback `_chat.$envId.weave.$runId` — confirm on Task 6.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-24-weave-v01-slice-4-web-ui.md`.** Awaiting user review per the handoff directive.

When approved, use **superpowers:subagent-driven-development**. Per-task model guidance:

- Tasks 1, 2, 3, 4, 5, 16, 17: **sonnet** — contract extension + store wiring + slash-command integration + tests require cross-file judgment.
- Tasks 6, 7, 8, 9, 10, 11, 12, 13, 14, 15: **haiku** — UI components with self-contained scope and clear code sketches.
- Task 18: **controller** (directly) — validation-only DoD gate.

**Execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 7 → 16 → 17 → 18. Task 7 (shell) is listed in the plan before its children for narrative clarity, but should be implemented AFTER Tasks 8–14 (its children) so it typechecks without stubbing. Task 16 (composer + slash command) lands after the UI components exist so it has a destination to navigate to.
