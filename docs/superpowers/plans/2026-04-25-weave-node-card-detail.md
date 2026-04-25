# Weave Node Card + Inspector Polish Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`. Steps use `- [ ]` checkbox syntax.
>
> **Pre-flight HEAD check is mandatory on every task.**

**Goal:** Make the Weave run view "somewhat usable" by surfacing per-node runtime state on the blueprint canvas and in the inspector. The Slice-4 UI ships nodes as static rows; this plan adds:

1. **Right-side info on each node card.** Failure reason when `status === "failed"`, an execution timer (`HH:MM:SS` since dispatch) when `status === "running"`. (Per-node "current turn" message preview is deferred — it requires per-node child-thread subscriptions and is too invasive for this slice.)
2. **Inspector with structured node detail.** Header above the embedded `ChatView` showing the node's title, description / vision, status, and dispatched timestamp. The chat below remains the execution log.

**Why now:** without these, a running weave run is a wall of identical-looking node rows with no progress feedback or failure surfacing — the user has to click into each child thread to figure out what's happening. The fixes are small and unblock real testing.

**Architecture in one paragraph:** Extend the `WeaveRunProjection.nodeStatuses` field from `ReadonlyMap<NodeId, Status>` to `ReadonlyMap<NodeId, NodeMeta>` where `NodeMeta = { status, dispatchedAt?, verifiedAt?, failedAt?, failureReason? }`. The projector populates the new fields from existing event payloads (`occurredAt`, `reason`) which already carry the data. The web store mirrors the change; `WeaveNodeCard` renders the new info; `WeaveInspector` reads the node + meta to render a structured header.

**Scope:** server + web. No new domain events (existing payloads suffice). One DB migration for the projection state shape.

**Out of scope (v0.2+):** per-node "current turn" 1-liner from child-thread state, click-to-tail-log, node restart UI.

---

## Branch setup

Branches off `nikrabaev/weave` post-`weave-v0.1-planner-integrated`.

```bash
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git rev-parse weave-v0.1-planner-integrated  # should resolve to current HEAD ancestor
```

At plan close, tag `weave-v0.1-node-card-detail` on `nikrabaev/weave`. No merge to `main`.

---

## Pre-flight HEAD check protocol

Every implementer subagent runs:

```
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code/.claude/worktrees/great-beaver-5aff1d
pwd                                    # MUST end in `/great-beaver-5aff1d`
git branch --show-current              # MUST be `claude/great-beaver-5aff1d`
git log --oneline HEAD~3..HEAD

The top three commits MUST match (newest first):
<EXPECTED_SHA_AND_TITLE_1>
<EXPECTED_SHA_AND_TITLE_2>
<EXPECTED_SHA_AND_TITLE_3>

If ANY mismatch, STOP and report `BLOCKED: wrong worktree/base`.
```

---

## Open design decisions (ready for execution)

1. **Shape of new field.** Replace `nodeStatuses: ReadonlyMap<NodeId, Status>` with `nodeMeta: ReadonlyMap<NodeId, { status, dispatchedAt?, verifiedAt?, failedAt?, failureReason? }>`. Status moves into the meta struct. **Recommended** to rename `nodeStatuses → nodeMeta` for clarity; document it as a rename in the contracts diff.
2. **Inspector visual.** A 2-section layout: top header card with `title`, `description`, `status` pill, `dispatchedAt`/elapsed time; bottom embeds `ChatView` (unchanged). Border / spacing in line with Slice 4 components.
3. **Timer cadence.** `useTickingNow(1000)` hook — re-renders consumer once a second. One instance per `WeaveBlueprintList` mount, passed down to running cards via prop.
4. **Plan-first execution.** This document. Implementer dispatches only after user approval.

---

## File deliverables at plan close

**New:**

```
apps/web/src/hooks/useTickingNow.ts
apps/web/src/hooks/useTickingNow.test.ts
apps/server/src/persistence/Migrations/027_ProjectionWeaveNodeMeta.ts
apps/server/src/persistence/Migrations/027_ProjectionWeaveNodeMeta.test.ts (if pattern exists)
```

**Modified:**

```
packages/contracts/src/weave.ts                        — add NodeMeta struct, rename nodeStatuses → nodeMeta
packages/contracts/src/weave.test.ts                   — round-trip
apps/server/src/orchestration/weaveProjector.ts        — populate dispatchedAt / verifiedAt / failedAt / failureReason
apps/server/src/persistence/Layers/<weave projection storage>  — read/write the new column / JSON shape
apps/web/src/store.ts                                  — applyWeaveEventToDetail handles new field
apps/web/src/weave/weaveStore.ts                       — selector accessors (selectNodeMeta)
apps/web/src/components/weave/WeaveNodeCard.tsx        — accept failureReason, dispatchedAt, now props; render right-side cluster
apps/web/src/components/weave/WeaveBlueprintList.tsx   — read meta; pass props down; tick clock
apps/web/src/components/weave/WeaveInspector.tsx       — structured header above ChatView
```

---

## Task 1: Contracts — `WeaveNodeMeta` + projection rename

**Files:**
- Modify `packages/contracts/src/weave.ts`:
  - Add `WeaveNodeMeta = Schema.Struct({ status: WeaveNodeStatus, dispatchedAt: optional IsoDateTime, verifiedAt: optional IsoDateTime, failedAt: optional IsoDateTime, failureReason: optional Schema.String })`.
  - Replace `nodeStatuses: ReadonlyMap(WeaveNodeId, WeaveNodeStatus)` with `nodeMeta: ReadonlyMap(WeaveNodeId, WeaveNodeMeta)` on `WeaveRunProjectionSchema`.
- Modify `packages/contracts/src/weave.test.ts` — round-trip tests for `WeaveNodeMeta` and the modified `WeaveRunProjectionSchema`.

**Pre-flight HEAD expectation:** top of `nikrabaev/weave`.

**Rationale:** Status alone was sufficient when the UI was a static list. To render per-node runtime info we need the timestamps + failure reason that already exist in event payloads but were thrown away by the projector.

This **breaks the contract shape** — every consumer that reads `nodeStatuses` needs to be updated. Tasks 2 and 3 cover the server + web sides.

- [ ] **Step 1.1: Add `WeaveNodeMeta`.** Place adjacent to `WeaveRunProjectionSchema` (line ~426 of `weave.ts`):

  ```ts
  export const WeaveNodeMeta = Schema.Struct({
    status: WeaveNodeStatus,
    dispatchedAt: Schema.optional(IsoDateTime),
    verifiedAt: Schema.optional(IsoDateTime),
    failedAt: Schema.optional(IsoDateTime),
    failureReason: Schema.optional(Schema.String),
  });
  export type WeaveNodeMeta = typeof WeaveNodeMeta.Type;
  ```

- [ ] **Step 1.2: Replace `nodeStatuses` field.** In `WeaveRunProjectionSchema`:

  ```ts
  // before:
  nodeStatuses: Schema.ReadonlyMap(WeaveNodeId, WeaveNodeStatus),
  // after:
  nodeMeta: Schema.ReadonlyMap(WeaveNodeId, WeaveNodeMeta),
  ```

- [ ] **Step 1.3: Round-trip tests.** Decode an empty `nodeMeta`, decode a populated entry with `status: "running"` + `dispatchedAt`, decode an entry with `status: "failed"` + `failedAt` + `failureReason`. Round-trip via `Schema.decodeUnknownEffect`.

- [ ] **Step 1.4: Format, typecheck, test, commit.**

  ```bash
  cd <worktree> && bun fmt packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
  cd <worktree> && bun typecheck
  cd <worktree>/packages/contracts && bun run test
  ```

  **Expected typecheck failures:** every consumer of `nodeStatuses` in `apps/server/src/` and `apps/web/src/` will break. That's the signal for Tasks 2 and 3 to fix them. Implementer commits ONLY the contract changes; the broken-typecheck downstream files will be patched by Task 2 (server) and Task 3 (web).

  Since `bun typecheck` will fail the whole monorepo, the implementer must skip typecheck verification for this commit and rely on `cd packages/contracts && bun typecheck` only (or `bun typecheck` with the failure expected and noted in the report).

  Commit: `feat(contracts): add WeaveNodeMeta + replace nodeStatuses with nodeMeta`.

  Note in commit message that downstream typecheck WILL fail until Tasks 2/3 land.

---

## Task 2: Server projector + persistence + tests

**Files:**
- Modify `apps/server/src/orchestration/weaveProjector.ts` — populate `nodeMeta` from event payloads.
- Modify `apps/server/src/orchestration/Layers/WeaveScheduler.ts` — if it reads `nodeStatuses` to decide ready set, update.
- Modify any other server reader of `nodeStatuses` (grep `nodeStatuses` server-wide).
- Add migration `027_ProjectionWeaveNodeMeta.ts` if the projection persistence stores `nodeStatuses` separately. If it serializes the whole projection as JSON via `Schema.encode` (likely), no migration needed because the field rename auto-applies.
- Update server tests that reference `nodeStatuses` — rename to `nodeMeta` and adjust assertions.

**Pre-flight HEAD expectation:** Task 1's commit.

- [ ] **Step 2.1: Inspect persistence path.** Grep `nodeStatuses` in `apps/server/src/persistence/` to confirm whether the projection is JSON-serialized as a whole or has individual columns. If JSON, no migration; if columnar, write migration.

- [ ] **Step 2.2: Update projector branches:**

  - `weave.blueprint-compiled`: rebuild `nodeMeta` with `{status: "pending"}` for each node.
  - `weave.node-dispatched`: `nodeMeta.set(nodeId, { status: "running", dispatchedAt: payload.occurredAt })`.
  - `weave.node-verified`: read existing `meta`, set `{ ...meta, status: "verified", verifiedAt: payload.occurredAt }`.
  - `weave.node-failed`: read existing `meta`, set `{ ...meta, status: "failed", failedAt: payload.occurredAt, failureReason: payload.reason }`.

- [ ] **Step 2.3: Update other readers.** `WeaveScheduler.computeReadySet` reads `nodeStatuses` — change to read `nodeMeta` and project `meta.status`. Same for any other consumer.

- [ ] **Step 2.4: Update server tests.** Rename `nodeStatuses` → `nodeMeta` in fixtures, assertions, and projector tests. Add a positive test that `weave.node-failed` populates `failureReason` and `failedAt` correctly.

- [ ] **Step 2.5: Format, typecheck, test, commit.**

  Server tests should all pass. Commit: `feat(server): populate WeaveNodeMeta from event payloads`.

---

## Task 3: Web store + selectors + browser tests

**Files:**
- Modify `apps/web/src/store.ts` — `applyWeaveEventToDetail` handles new field.
- Modify `apps/web/src/weave/weaveStore.ts` — add `useNodeMeta(envId, runId, nodeId)` selector.
- Update existing selectors that read `detail.nodeStatuses` to read `detail.nodeMeta.get(id)?.status`.
- Update browser tests that build `WeaveRunProjection` fixtures.

**Pre-flight HEAD expectation:** Task 2's commit.

- [ ] **Step 3.1: Update `applyWeaveEventToDetail`.** Mirror the server projector logic for each weave event:
  - `weave.blueprint-compiled` → rebuild `nodeMeta` with `{status: "pending"}` per node.
  - `weave.node-dispatched` → set `dispatchedAt`.
  - `weave.node-verified` → set `verifiedAt`.
  - `weave.node-failed` → set `failedAt` + `failureReason`.

- [ ] **Step 3.2: Selectors.** Update `useWeaveRunDetail` callers as needed. Add a small accessor:

  ```ts
  export function getNodeMeta(detail: WeaveRunProjection, nodeId: WeaveNodeId): WeaveNodeMeta | null {
    return detail.nodeMeta.get(nodeId) ?? null;
  }
  ```

  No new hook required — components can call `getNodeMeta(detail, node.id)` inline.

- [ ] **Step 3.3: Update consumers.** `WeaveBlueprintList`, `WeaveInspector`, `WeaveView` all currently read `detail.nodeStatuses.get(id)`. Replace with `detail.nodeMeta.get(id)?.status`.

- [ ] **Step 3.4: Update browser tests.** Fixtures in `WeaveView.browser.tsx` build a projection — change `nodeStatuses` → `nodeMeta` with appropriate meta entries.

- [ ] **Step 3.5: Format, typecheck, test, commit.**

  Web tests should pass. Commit: `feat(web): apply WeaveNodeMeta in store + selectors`.

---

## Task 4: UI — `useTickingNow`, node-card right cluster, inspector header

**Files:**
- Create `apps/web/src/hooks/useTickingNow.ts` + `.test.ts`.
- Modify `apps/web/src/components/weave/WeaveNodeCard.tsx` — accept `meta: WeaveNodeMeta | null` and `now: number`; render right-side cluster.
- Modify `apps/web/src/components/weave/WeaveBlueprintList.tsx` — call `useTickingNow(1000)`; pass `meta` + `now` to each card.
- Modify `apps/web/src/components/weave/WeaveInspector.tsx` — structured header above `ChatView`.

**Pre-flight HEAD expectation:** Task 3's commit.

- [ ] **Step 4.1: `useTickingNow` hook.**

  ```ts
  // apps/web/src/hooks/useTickingNow.ts
  import { useEffect, useState } from "react";

  /**
   * Re-renders the consumer at the requested interval, returning Date.now()
   * each time. Used for elapsed-time displays that don't need millisecond
   * precision. Stops ticking on unmount.
   */
  export function useTickingNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), intervalMs);
      return () => clearInterval(id);
    }, [intervalMs]);
    return now;
  }
  ```

  Test: render a component using the hook, advance fake timers, assert the returned value updates.

- [ ] **Step 4.2: `WeaveNodeCard` right cluster.**

  Add to props:

  ```ts
  readonly meta: WeaveNodeMeta | null;
  readonly now: number;  // epoch ms — provided by parent's useTickingNow
  ```

  Render a right-side block (after the existing flex-1 main column, before the closing `</button>`):

  ```tsx
  <div className="text-xs text-muted-foreground shrink-0 max-w-[40%] text-right">
    {status === "failed" && meta?.failureReason && (
      <span className="text-red-600 truncate">{meta.failureReason}</span>
    )}
    {status === "running" && meta?.dispatchedAt && (
      <span>{formatElapsed(now - new Date(meta.dispatchedAt).getTime())}</span>
    )}
    {status === "verified" && meta?.verifiedAt && meta?.dispatchedAt && (
      <span>
        {formatElapsed(
          new Date(meta.verifiedAt).getTime() - new Date(meta.dispatchedAt).getTime(),
        )}
      </span>
    )}
  </div>
  ```

  Helper `formatElapsed(ms: number): string` returns `"0:23"`, `"1:45"`, `"12:03"`, `"1:02:34"` style.

- [ ] **Step 4.3: `WeaveBlueprintList` plumbing.**

  Add `const now = useTickingNow(1000);` near the top of the component. Pass `meta={detail.nodeMeta.get(node.id) ?? null}` and `now={now}` to each `WeaveNodeCard`.

- [ ] **Step 4.4: `WeaveInspector` header.**

  Look up the current node from the blueprint:

  ```ts
  const node = weaveRunDetail.currentBlueprint?.nodes.find((n) => n.id === openNodeId) ?? null;
  const meta = weaveRunDetail.nodeMeta.get(openNodeId) ?? null;
  ```

  Replace the existing simple header (`Node: {openNodeId}`) with:

  ```tsx
  <header className="px-4 py-3 border-b border-border space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold truncate">{node?.title ?? openNodeId}</h2>
      <StatusPill status={meta?.status ?? "pending"} />
    </div>
    {node?.description && (
      <p className="text-sm text-muted-foreground">{node.description}</p>
    )}
    {meta?.dispatchedAt && (
      <p className="text-xs text-muted-foreground">
        Dispatched {formatRelativeTime(meta.dispatchedAt)}
      </p>
    )}
    {meta?.failureReason && (
      <p className="text-xs text-red-600">Failed: {meta.failureReason}</p>
    )}
  </header>
  ```

  Move the existing "Open thread ↗" / "Open worktree" buttons into a sub-row of this header, or keep as a separate flex line. The `<ChatView>` renders below — unchanged.

- [ ] **Step 4.5: Format, typecheck, test, commit.**

  ```bash
  cd <worktree> && bun fmt apps/web/src/hooks/useTickingNow.ts apps/web/src/hooks/useTickingNow.test.ts apps/web/src/components/weave/WeaveNodeCard.tsx apps/web/src/components/weave/WeaveBlueprintList.tsx apps/web/src/components/weave/WeaveInspector.tsx
  cd <worktree> && bun typecheck
  cd <worktree>/apps/web && bun run test
  ```

  Commit: `feat(web): node card meta + inspector header`.

---

## Task 5: DoD + tag

**Pre-flight HEAD expectation:** Task 4's commit.

- [ ] **Step 5.1: Visual smoke.** `bun dev`, `/weave` an existing project, watch a node go through dispatch → running with timer → verified or failed with reason. Confirm clicking a node opens the inspector with title/description/status.

- [ ] **Step 5.2: Repo-wide checks.** `bun typecheck`, `bun run test`, `bun lint`. GitManager flakies tolerance unchanged (≤7).

- [ ] **Step 5.3: Tag.**

  ```bash
  git tag weave-v0.1-node-card-detail <Task 4's commit SHA>
  ```

---

## Self-review summary

- **No new domain events.** Existing `weave.node-dispatched` / `weave.node-verified` / `weave.node-failed` payloads carry every datum the new projection field needs.
- **Backward-compat risk:** the projection field rename (`nodeStatuses → nodeMeta`) is a breaking shape change. If projection persistence stores the field as JSON (likely — Schema.encode of the whole projection), existing rows decode against the new schema and the optional fields default to absent. If it stores per-key columns, a migration is required (Task 2 step 2.1).
- **Out of scope:** "current turn" 1-liner from child-thread state; inline log streaming; node restart UI. All deferred to later slices.
- **Per-task model guidance:** Task 1 sonnet (contract design + breaking rename); Task 2 sonnet (multi-file projector + readers); Task 3 sonnet (web store + selectors); Task 4 haiku (UI components + hook).

---

## Execution handoff

Per-task model guidance:

- Tasks 1, 2, 3: **sonnet**
- Task 4: **haiku**
- Task 5: **controller** (validation only)

Execution order: 1 → 2 → 3 → 4 → 5.
