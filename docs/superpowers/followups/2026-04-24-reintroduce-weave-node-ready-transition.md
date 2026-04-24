# Follow-up: Reintroduce `weave.node.ready` State Transition

**Filed:** 2026-04-24
**Relevant slice:** v0.2 (parallelisation)
**Context commit:** feat(server): add WeaveScheduler — sequential dispatch with worktree allocation

## What was skipped

In v0.1 the `WeaveScheduler` dispatches nodes directly from `"pending"` status,
bypassing an explicit `"ready"` intermediate state. To accommodate this the
`weaveDecider.ts` `weave.node.dispatch` case was changed to accept
`allowed: ["pending", "ready"]` instead of `allowed: ["ready"]`.

There is no `weave.node.ready` command or event in v0.1. The scheduler computes
the ready set on-the-fly (nodes in `"pending"` with all `dependsOn` in
`"verified"`) and dispatches immediately.

## Why it matters

Without a distinct `"ready"` status there is no stable way to observe or reason
about "scheduled and ready to run but not yet dispatched" nodes separately from
"not yet considered". In v0.2 when the concurrencyCap is greater than 1, the
scheduler may want to:

- Mark a node `"ready"` to signal it has been evaluated.
- Gate actual dispatch on the concurrency cap without losing track of which
  nodes are waiting in the ready queue.
- Let external observers (UI, monitoring) see pre-dispatch state.

## Recommended resolution in v0.2

1. Add `"ready"` to the `WeaveNodeStatus` union (contracts layer).
2. Add a `weave.node.ready` command and a matching `weave.node-ready` event.
3. Update `weaveDecider.ts` `weave.node.dispatch` back to `allowed: ["ready"]`.
4. In `WeaveScheduler.ts`, emit `weave.node.ready` for each ready node and
   enqueue the actual dispatch as a separate step gated on concurrencyCap.
5. Update the projector and read-model queries for the new status.
6. Remove the tech-debt comment in `weaveDecider.ts`.
