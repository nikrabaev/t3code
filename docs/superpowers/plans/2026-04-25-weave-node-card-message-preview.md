# Weave Node Card — Per-Node "Current Turn" Message Preview

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`. Steps use `- [ ]` checkbox syntax.
>
> **Pre-flight HEAD check is mandatory on every task.**

**Goal:** Add a 1-line preview of the child thread's latest assistant message text to each running node's row in `WeaveBlueprintList`. Closes the gap left by `weave-v0.1-node-card-detail` (which only added the failure reason and execution timer; the user explicitly asked for "the current turn of the execution must be displayed as a 1-liner on the right side of the node when it's running").

**Why now:** without this, a running weave is a wall of node rows with timers but no signal as to *what each agent is actually doing right now*. A truncated 1-line preview of the latest assistant text is the smallest readable signal and was the user's stated requirement.

**Architecture in one paragraph:** For each blueprint node whose `meta.status === "running"`, retain a per-node `ThreadDetailSubscription` against `meta.childThreadId` for the duration the node is running. The retained subscription populates `state.environmentStateById[envId].threadDetailById[threadId]` in the store; a small selector reads the most recent assistant message text from `thread.messages`, returns it as a string, and the existing `WeaveNodeCard` right cluster renders it (truncated to one line) above the timer when `meta.status === "running"`. Release subscriptions on unmount and when a node leaves the running state.

**Scope:** web only. No contract / server changes. The thread shell snapshot already covers the dispatched-thread row (since weave child threads have `kind: "chat"` and aren't filtered); we only need detail-level retention to read the message body.

**Out of scope:** interleaving tool-call / activity events into the preview, streaming partial deltas at sub-second cadence, message preview for verified / failed nodes (those use the existing failure reason / verified duration cluster — running is the only state with a live preview).

---

## Branch setup

Branches off `nikrabaev/weave` post-`weave-v0.1-node-card-detail`.

```bash
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git rev-parse weave-v0.1-node-card-detail
git log --oneline weave-v0.1-node-card-detail | head -1
```

At plan close, tag `weave-v0.1-node-card-message-preview` on `nikrabaev/weave`. No merge to `main`.

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

## File deliverables

**New:**

```
apps/web/src/weave/useWeaveRunningNodeSubscriptions.ts        — hook: retains thread-detail subs for running nodes
apps/web/src/weave/useWeaveRunningNodeSubscriptions.test.ts   — unit tests
```

**Modified:**

```
apps/web/src/weave/weaveStore.ts                              — selector: latestAssistantTextByThreadId
apps/web/src/components/weave/WeaveBlueprintList.tsx          — call the new hook; pass `latestMessage` per card
apps/web/src/components/weave/WeaveNodeCard.tsx               — new optional `latestMessage` prop; render above timer when status === "running"
apps/web/src/components/weave/WeaveView.browser.tsx           — fixture for new prop (if test file constructs detail with running node)
```

---

## Task 1: Subscription manager — `useWeaveRunningNodeSubscriptions`

**Files:**
- Create `apps/web/src/weave/useWeaveRunningNodeSubscriptions.ts`.
- Create `apps/web/src/weave/useWeaveRunningNodeSubscriptions.test.ts`.

**Pre-flight HEAD expectation:** top of `nikrabaev/weave` (post-`weave-v0.1-node-card-detail`).

**Rationale:** The blueprint may have many nodes but only a small number running at once (concurrencyCap = 1 in v0.1). A targeted hook that retains exactly the running set keeps subscription churn low and correctness obvious.

- [ ] **Step 1.1: API design.** The hook signature:

  ```ts
  export function useWeaveRunningNodeSubscriptions(
    environmentId: EnvironmentId,
    runningChildThreadIds: ReadonlyArray<ThreadId>,
  ): void;
  ```

  Implementation:

  ```ts
  import { useEffect } from "react";
  import { retainThreadDetailSubscription } from "../environments/runtime/service";

  export function useWeaveRunningNodeSubscriptions(
    environmentId: EnvironmentId,
    runningChildThreadIds: ReadonlyArray<ThreadId>,
  ): void {
    useEffect(() => {
      const releases = runningChildThreadIds.map((threadId) =>
        retainThreadDetailSubscription(environmentId, threadId),
      );
      return () => {
        for (const release of releases) release();
      };
    }, [environmentId, runningChildThreadIds.join("|")]); // stable join — see note
  }
  ```

  **Stability note:** depending on `runningChildThreadIds` directly causes the effect to re-run every render because the parent passes a fresh array. Use a `.join("|")` of sorted ids as a string dep so the effect only re-runs when the *content* changes. Document this clearly.

- [ ] **Step 1.2: Tests.** Use vitest + jsdom (or node) — no real React rendering needed. Mock `retainThreadDetailSubscription` to return a spy `release()` function. Verify:

  - On mount with `["t-1", "t-2"]`, retains both threads.
  - On rerender with `["t-1"]`, releases `t-2`.
  - On unmount, releases all retained.
  - Stable rerender with the same content (different array reference) does NOT re-retain (effect skipped).

- [ ] **Step 1.3: Format, typecheck, test, commit.**

  ```bash
  cd <worktree> && bun fmt apps/web/src/weave/useWeaveRunningNodeSubscriptions.ts apps/web/src/weave/useWeaveRunningNodeSubscriptions.test.ts
  cd <worktree> && bun typecheck
  cd <worktree>/apps/web && bun run test
  ```

  Commit: `feat(web): add useWeaveRunningNodeSubscriptions hook`.

---

## Task 2: Wire selector + render preview in `WeaveNodeCard`

**Files:**
- Modify `apps/web/src/weave/weaveStore.ts` — add selector / accessor for "latest assistant text by thread id".
- Modify `apps/web/src/components/weave/WeaveBlueprintList.tsx` — call `useWeaveRunningNodeSubscriptions`; for each running node, derive `latestMessage` and pass to the card.
- Modify `apps/web/src/components/weave/WeaveNodeCard.tsx` — accept `latestMessage?: string`; render it as a one-line truncated span when status === "running".
- Modify `apps/web/src/components/weave/WeaveView.browser.tsx` — update fixture if a running-node test exists.

**Pre-flight HEAD expectation:** Task 1's commit.

- [ ] **Step 2.1: Selector.** Add to `weaveStore.ts`:

  ```ts
  /**
   * Read the most recent assistant message text for a child thread, used to
   * render the running-node 1-liner preview. Returns null if the thread isn't
   * loaded in detail state, or if there's no assistant message yet.
   *
   * Caller is expected to have already retained the subscription via
   * useWeaveRunningNodeSubscriptions.
   */
  export function useLatestAssistantText(
    environmentId: EnvironmentId,
    threadId: ThreadId,
  ): string | null {
    return useStore((state) => {
      const detail = state.environmentStateById[environmentId]?.threadDetailById[threadId];
      if (!detail) return null;
      // Walk backwards looking for the last assistant message with text content.
      for (let i = detail.messages.length - 1; i >= 0; i--) {
        const msg = detail.messages[i];
        if (msg?.role === "assistant" && typeof msg.text === "string" && msg.text.length > 0) {
          return msg.text;
        }
      }
      return null;
    });
  }
  ```

  Adapt the field names if `messages` / `role` / `text` differ in this codebase — grep `apps/web/src/store.ts` and `packages/contracts/src/orchestration.ts` for the actual `OrchestrationMessage` shape. The Slice-4 `weaveThreadSnapshot.ts` already has logic that walks user/assistant messages — read that helper to confirm the shape.

  No `useShallow` needed — the selector returns a primitive (`string | null`), so reference identity is fine.

- [ ] **Step 2.2: Wire `WeaveBlueprintList`.**

  Compute the running child thread ids from `detail.nodeMeta` + `detail.childThreads`:

  ```ts
  const runningChildThreadIds = useMemo(() => {
    const ids: ThreadId[] = [];
    for (const [nodeId, meta] of detail.nodeMeta) {
      if (meta.status === "running") {
        const child = detail.childThreads.get(nodeId);
        if (child) ids.push(child.threadId);
      }
    }
    ids.sort();  // stable order for the join key
    return ids;
  }, [detail.nodeMeta, detail.childThreads]);

  useWeaveRunningNodeSubscriptions(environmentId, runningChildThreadIds);
  ```

  Then for each rendered node, look up the message and pass to the card. Since `useLatestAssistantText` is a hook and can't be called per-row, lift the calls to a small child component or a per-node `<NodeRow>` wrapper that calls the hook itself:

  ```tsx
  function NodeRow({ node, detail, environmentId, weaveRunId, openNodeId, now }: NodeRowProps) {
    const meta = detail.nodeMeta.get(node.id) ?? null;
    const childThreadId =
      meta?.status === "running" ? (detail.childThreads.get(node.id)?.threadId ?? null) : null;
    const latestMessage = useLatestAssistantText(environmentId, childThreadId ?? ("__none__" as ThreadId));
    return (
      <WeaveNodeCard
        node={node}
        meta={meta}
        now={now}
        latestMessage={childThreadId ? latestMessage : null}
        // ... existing props
      />
    );
  }
  ```

  `useLatestAssistantText` returns null when the thread isn't loaded, so the `__none__` placeholder is harmless. Consider an explicit early-return null variant if the placeholder feels hacky.

- [ ] **Step 2.3: Render in `WeaveNodeCard`.**

  Add to props:

  ```ts
  readonly latestMessage?: string | null;
  ```

  Render above the existing timer in the right cluster, only when `meta?.status === "running"`:

  ```tsx
  {status === "running" && latestMessage && (
    <span className="block text-xs text-muted-foreground italic truncate">
      {latestMessage}
    </span>
  )}
  ```

  Place it ABOVE the timer (timer drops to a second line) so the message gets visual priority. Truncate-on-overflow keeps the row to two lines max.

- [ ] **Step 2.4: Browser test fixture.** If `WeaveView.browser.tsx` constructs a running-node fixture, ensure the new optional prop doesn't break the test. The hook will no-op with empty subs in the test harness as long as `retainThreadDetailSubscription` is mockable / safe.

- [ ] **Step 2.5: Format, typecheck, test, commit.**

  ```bash
  cd <worktree> && bun fmt apps/web/src/weave/weaveStore.ts apps/web/src/components/weave/WeaveBlueprintList.tsx apps/web/src/components/weave/WeaveNodeCard.tsx apps/web/src/components/weave/WeaveView.browser.tsx
  cd <worktree> && bun typecheck
  cd <worktree>/apps/web && bun run test
  ```

  Commit: `feat(web): per-node current-turn 1-liner from child thread state`.

---

## Task 3: DoD + tag

**Pre-flight HEAD expectation:** Task 2's commit.

- [ ] **Step 3.1: Visual smoke.** `bun dev`. Run a `/weave` against a project with a planner-compiled blueprint. Approve. Watch a node go to running. Confirm:
  - The right side of the running node shows a one-line italic preview of the child thread's latest assistant text.
  - The preview updates as the agent makes progress (every event-driven re-render of the parent).
  - On verify or fail, the preview disappears (status leaves "running"), replaced by the verified-duration / failure-reason cluster.
- [ ] **Step 3.2: Repo-wide checks.** `bun typecheck`, `bun run test`, `bun lint`. GitManager flakies tolerance unchanged (≤7).
- [ ] **Step 3.3: Tag.**

  ```bash
  git tag weave-v0.1-node-card-message-preview <Task 2's commit SHA>
  ```

---

## Self-review summary

- **No new contract / server work.** The data is already in the thread detail snapshot. The "subscription per running node" approach is a known pattern (`retainThreadDetailSubscription` exists). Just wire it.
- **Subscription churn.** Bounded by the concurrency cap (1 in v0.1). Even at v0.2's 8, that's a tiny number of detail subscriptions.
- **Re-render cost.** `useLatestAssistantText` is called once per node row. For a 9-node blueprint with 1 running, 9 selectors run on each store update; 8 of them return null instantly (early return on missing detail). Acceptable.
- **Edge cases:** thread loading delay (preview shows nothing for a brief moment — fine, not flickery); thread with no assistant message yet (returns null — preview hidden; status pill + timer still visible); thread evicted between status flip and unmount (preview disappears one frame early — harmless).
- **Out of scope:** activity / tool-call interleaving in the preview, sub-second streaming (the existing event-driven re-render is sufficient for "1-liner" precision).

---

## Execution handoff

Per-task model guidance:

- Task 1: **sonnet** (subscription lifecycle correctness)
- Task 2: **sonnet** (multi-file UI + data flow)
- Task 3: **controller** (validation only)

Execution order: 1 → 2 → 3.
