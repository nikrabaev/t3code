# Weave Delete Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Delete weave" button to the WeaveExecutionHeader that hard-deletes a Weave Run from the read model after a confirmation dialog.

**Architecture:** Introduce a new `weave.delete` dispatchable client command + `weave.deleted` event. The decider validates the run exists; the main projector (`projector.ts`) hard-removes the run from `readModel.weaveRuns`; the WebSocket shell stream emits the existing `weave-run-removed` event so clients drop the run from local state. The web UI adds a destructive `AlertDialog`-confirmed button to `WeaveExecutionHeader`; on success the user is navigated back to the environment root. Hard delete (rather than soft `deletedAt`) is used because `WeaveRun` has no `deletedAt` field and the shell stream already has a `weave-run-removed` variant designed for this.

**Tech Stack:** Effect 4 + effect/Schema (contracts), TypeScript, Vitest, React + base-ui (web), TanStack Router, Zustand.

**Out of scope:** Cascading deletion of child threads, worktrees, or planner threads. Child threads that exist in the projection's `childThreads` map remain — deleting them is a separate concern that goes through `thread.delete` already. The confirmation dialog will surface this fact to the user.

---

## File Structure

**Contracts (modify):**

- [packages/contracts/src/weave.ts](packages/contracts/src/weave.ts) — add `WeaveDeleteCommand`, `WeaveDeletedPayload`, append to `WeaveDispatchableCommand` union.
- [packages/contracts/src/orchestration.ts](packages/contracts/src/orchestration.ts) — append `WeaveDeleteCommand` to `DispatchableClientOrchestrationCommand` and `ClientOrchestrationCommand`; append `"weave.deleted"` literal to `OrchestrationEventType`; append the `weave.deleted` event variant to the `OrchestrationEvent` union.

**Server (modify):**

- [apps/server/src/orchestration/weaveDecider.ts](apps/server/src/orchestration/weaveDecider.ts) — add `case "weave.delete"` that emits a `weave.deleted` event.
- [apps/server/src/orchestration/decider.ts](apps/server/src/orchestration/decider.ts) — add `"weave.delete"` to the weave-command fallthrough group at line 749 so it is routed to `decideWeaveCommand`.
- [apps/server/src/orchestration/projector.ts](apps/server/src/orchestration/projector.ts) — add a separate `case "weave.deleted"` that removes the run from `model.weaveRuns` (does NOT call `projectWeaveEvent`).
- [apps/server/src/orchestration/weaveProjector.ts](apps/server/src/orchestration/weaveProjector.ts) — add a defensive `case "weave.deleted"` that returns state unchanged with a comment, so the exhaustive `_exhaustive: never` assignment continues to type-check (the case should never actually fire because `projector.ts` short-circuits).
- [apps/server/src/ws.ts](apps/server/src/ws.ts) — extend the shell-stream event projection (line 332 default branch) so `weave.deleted` emits a `weave-run-removed` shell stream event instead of falling through to the read-model lookup (which would return undefined and emit nothing).

**Server tests (modify):**

- [apps/server/src/orchestration/weaveDecider.test.ts](apps/server/src/orchestration/weaveDecider.test.ts) — add a `describe("decideWeaveCommand — weave.delete", …)` block.
- [apps/server/src/ws.weave.test.ts](apps/server/src/ws.weave.test.ts) — add an integration test driving create → delete and asserting the run is gone.

**Web (modify):**

- [apps/web/src/components/weave/WeaveExecutionHeader.tsx](apps/web/src/components/weave/WeaveExecutionHeader.tsx) — add a delete button + AlertDialog; accept new `environmentId` prop and `onDeleted` callback; call `dispatchWeaveCommand`.
- [apps/web/src/components/weave/WeaveView.tsx](apps/web/src/components/weave/WeaveView.tsx) — pass `environmentId` and an `onDeleted` callback that navigates to `/$environmentId`.
- [apps/web/src/store.ts](apps/web/src/store.ts) — extend the `weave-run-removed` reducer (line 1901) to also clean `weaveRunDetailById`.
- [apps/web/src/orchestrationEventEffects.ts](apps/web/src/orchestrationEventEffects.ts) — add `case "weave.deleted":` to the exhaustive switch (no-op like the other weave cases).

**Web tests (modify / create):**

- [apps/web/src/components/weave/WeaveExecutionHeader.test.tsx](apps/web/src/components/weave/WeaveExecutionHeader.test.tsx) — new file; smoke-test the dialog open/cancel/confirm flow.
- [apps/web/src/store.test.ts](apps/web/src/store.test.ts) — add a test that `weave-run-removed` clears both `weaveRunsById` and `weaveRunDetailById`.

---

## Task 1: Contracts — `WeaveDeleteCommand` and `weave.deleted` event

**Files:**

- Modify: `packages/contracts/src/weave.ts:264-306`, `packages/contracts/src/weave.ts:519-524`
- Modify: `packages/contracts/src/orchestration.ts:709-734`, `packages/contracts/src/orchestration.ts:738-763`, `packages/contracts/src/orchestration.ts:854-893`, `packages/contracts/src/orchestration.ts:1213-1278`

- [ ] **Step 1: Add `WeaveDeleteCommand` schema**

In [packages/contracts/src/weave.ts](packages/contracts/src/weave.ts), add the new command struct after `WeaveExitCommand` (around line 270, before `WeaveNodeRetryCommand`):

```ts
export const WeaveDeleteCommand = Schema.Struct({
  type: Schema.Literal("weave.delete"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  createdAt: IsoDateTime,
});
export type WeaveDeleteCommand = typeof WeaveDeleteCommand.Type;
```

- [ ] **Step 2: Append `WeaveDeleteCommand` to the dispatchable union**

In [packages/contracts/src/weave.ts](packages/contracts/src/weave.ts) at the `WeaveDispatchableCommand` union (line 297-305), add a new entry between `WeaveExitCommand` and `WeaveNodeRetryCommand`:

```ts
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
```

- [ ] **Step 3: Add `WeaveDeletedPayload` schema**

In [packages/contracts/src/weave.ts](packages/contracts/src/weave.ts) immediately after `WeaveExitedPayload` (around line 524, before `WeavePlannerThreadCreatedPayload`):

```ts
export const WeaveDeletedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  occurredAt: IsoDateTime,
});
export type WeaveDeletedPayload = typeof WeaveDeletedPayload.Type;
```

- [ ] **Step 4: Register the command in `DispatchableClientOrchestrationCommand` and `ClientOrchestrationCommand`**

In [packages/contracts/src/orchestration.ts](packages/contracts/src/orchestration.ts), add `WeaveDeleteCommand` to both unions (lines 709-734 and 738-763). Append it after `WeaveExitCommand` in each:

```ts
// In DispatchableClientOrchestrationCommand (line ~730)
WeaveExitCommand,
WeaveDeleteCommand,
WeaveNodeRetryCommand,
WeaveNodeRestartCommand,

// And the same insertion in ClientOrchestrationCommand (line ~760)
```

You will also need to add `WeaveDeleteCommand` to the existing `from "./weave.ts"` import block at the top of `orchestration.ts` (search for `WeaveExitCommand` in the imports and add the new symbol on the next line).

- [ ] **Step 5: Register the `"weave.deleted"` event type and event variant**

In [packages/contracts/src/orchestration.ts](packages/contracts/src/orchestration.ts):

1. In `OrchestrationEventType` (lines 854-893), append `"weave.deleted",` after `"weave.exited",` (line 889):

```ts
"weave.exited",
"weave.deleted",
// Weave planner events (Slice 3 Task 2)
"weave.planner.thread-created",
```

2. In the `OrchestrationEvent` union (around line 1269), add a new variant after the `weave.exited` block:

```ts
Schema.Struct({
  ...EventBaseFields,
  type: Schema.Literal("weave.exited"),
  payload: WeaveExitedPayload,
}),
Schema.Struct({
  ...EventBaseFields,
  type: Schema.Literal("weave.deleted"),
  payload: WeaveDeletedPayload,
}),
```

Add `WeaveDeletedPayload` to the `from "./weave.ts"` import block at the top of `orchestration.ts`.

- [ ] **Step 6: Run typecheck to verify schema wiring**

Run: `bun typecheck`
Expected: PASS in `packages/contracts`. Failures elsewhere (non-exhaustive switches in decider/projector/store/effects) are expected and will be addressed by the subsequent tasks. Note any unexpected error locations and review against the plan.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/orchestration.ts
git commit -m "feat(contracts): add weave.delete command and weave.deleted event"
```

---

## Task 2: Server decider — handle `weave.delete`

**Files:**

- Modify: `apps/server/src/orchestration/weaveDecider.ts:153-171` (insert new case after `weave.exit`)
- Modify: `apps/server/src/orchestration/decider.ts:749-765` (add `weave.delete` to the weave routing group)

- [ ] **Step 1: Write the failing test**

In [apps/server/src/orchestration/weaveDecider.test.ts](apps/server/src/orchestration/weaveDecider.test.ts), append after the existing `weave.exit` describe block:

```ts
describe("decideWeaveCommand — weave.delete", () => {
  it("emits weave.deleted when run exists", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: emptyProjection(),
        command: {
          type: "weave.delete",
          commandId: CommandId.make("cmd-del"),
          weaveRunId: WeaveRunId.make("run-1"),
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.deleted");
    expect(events[0]?.aggregateKind).toBe("weave");
    expect(events[0]?.aggregateId).toBe(WeaveRunId.make("run-1"));
  });

  it("emits weave.deleted even when run is in a terminal state", async () => {
    const base = emptyProjection();
    const terminal: WeaveRunProjection = {
      ...base,
      run: { ...base.run, status: "complete" },
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: terminal,
        command: {
          type: "weave.delete",
          commandId: CommandId.make("cmd-del-terminal"),
          weaveRunId: WeaveRunId.make("run-1"),
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("weave.deleted");
  });

  it("rejects weave.delete when run does not exist", async () => {
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: null,
          command: {
            type: "weave.delete",
            commandId: CommandId.make("cmd-del-missing"),
            weaveRunId: WeaveRunId.make("run-missing"),
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/orchestration/weaveDecider.test.ts`
Expected: FAIL — three new test cases fail because the decider does not yet handle `weave.delete` (or TypeScript narrowing rejects the command literal because the case is missing).

- [ ] **Step 3: Add the decider case**

In [apps/server/src/orchestration/weaveDecider.ts](apps/server/src/orchestration/weaveDecider.ts), insert a new case immediately after the `weave.exit` block (after line 171, before `weave.node.dispatch`):

```ts
case "weave.delete": {
  return Effect.gen(function* () {
    yield* requireRun({ projection, command });
    return [
      envelope({
        type: "weave.deleted",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
```

Note: deletion is allowed in any non-absent state — including `running`, `complete`, `aborted`. We deliberately do not call `requireRunNotTerminal` because the user must be able to delete a finished run.

- [ ] **Step 4: Route the command in the main decider**

In [apps/server/src/orchestration/decider.ts](apps/server/src/orchestration/decider.ts) at the weave-command fallthrough group (line 749-765), add `case "weave.delete":` so the command reaches `decideWeaveCommand`:

```ts
case "weave.create":
case "weave.blueprint.approve":
case "weave.blueprint.extend":
case "weave.phase.approve":
case "weave.decision.resolve":
case "weave.exit":
case "weave.delete":
case "weave.blueprint.compile":
case "weave.node.dispatch":
case "weave.node.verified":
case "weave.node.failed":
case "weave.node.retry":
case "weave.node.restart": {
  const runId = command.weaveRunId;
  const projection = readModel.weaveRuns.get(runId) ?? null;
  const plannedEvents = yield* decideWeaveCommand({ projection, command });
  return plannedEvents;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test apps/server/src/orchestration/weaveDecider.test.ts`
Expected: PASS — all three new cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/orchestration/weaveDecider.ts apps/server/src/orchestration/weaveDecider.test.ts apps/server/src/orchestration/decider.ts
git commit -m "feat(server): decider handles weave.delete command"
```

---

## Task 3: Server projector — handle `weave.deleted` event

**Files:**

- Modify: `apps/server/src/orchestration/projector.ts:689-708` (split out `weave.deleted` from the grouped fallthrough)
- Modify: `apps/server/src/orchestration/weaveProjector.ts:84-385` (add defensive case for exhaustive type-check)

- [ ] **Step 1: Write the failing test**

In [apps/server/src/orchestration/weaveProjector.test.ts](apps/server/src/orchestration/weaveProjector.test.ts), append a new describe block at the end of the file:

```ts
describe("projectWeaveEvent — weave.deleted", () => {
  it("returns state unchanged when state is non-null (deletion is handled at the read-model level)", async () => {
    const created = await Effect.runPromise(
      projectWeaveEvent(
        null,
        weaveEvent("weave.created", {
          weaveRunId: WeaveRunId.make("run-1"),
          projectId: ProjectId.make("project-1"),
          title: "x",
          vision: "",
          occurredAt: now,
        }),
      ),
    );
    const after = await Effect.runPromise(
      projectWeaveEvent(
        created,
        weaveEvent("weave.deleted", {
          weaveRunId: WeaveRunId.make("run-1"),
          occurredAt: now,
        }),
      ),
    );
    expect(after).toBe(created);
  });
});
```

This locks in the contract that `projectWeaveEvent` is a no-op for `weave.deleted`; actual map removal happens in the upper-level projector (next step).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/orchestration/weaveProjector.test.ts`
Expected: FAIL with TypeScript error about non-exhaustive switch (the `weave.deleted` event variant is now in `WeaveOrchestrationEvent` and the switch's `_exhaustive: never` assignment fails) OR test failure when the case is missing.

- [ ] **Step 3: Add the defensive case to `weaveProjector.ts`**

In [apps/server/src/orchestration/weaveProjector.ts](apps/server/src/orchestration/weaveProjector.ts), add a case before the `default:` block (around line 377):

```ts
case "weave.deleted": {
  // Hard delete is performed at the read-model level in projector.ts, which
  // removes the run entry from `weaveRuns` without invoking projectWeaveEvent.
  // This case exists only to keep the exhaustive `_exhaustive: never` check
  // happy; it must never actually be reached.
  return Effect.succeed(state ?? (null as never));
}
```

- [ ] **Step 4: Add the deletion case to the main `projector.ts`**

In [apps/server/src/orchestration/projector.ts](apps/server/src/orchestration/projector.ts), add a new `case "weave.deleted":` arm BEFORE the grouped weave fallthrough block at line 689 (so it short-circuits before `projectWeaveEvent` is invoked):

```ts
case "weave.deleted": {
  const runId = event.payload.weaveRunId;
  if (!model.weaveRuns.has(runId)) {
    return Effect.succeed(nextBase);
  }
  const nextWeaveRuns = new Map(model.weaveRuns);
  nextWeaveRuns.delete(runId);
  return Effect.succeed({ ...nextBase, weaveRuns: nextWeaveRuns });
}

case "weave.created":
case "weave.blueprint-compiled":
// ... existing cases unchanged
case "weave.exited": {
  const runId = event.payload.weaveRunId;
  // ... unchanged body
}
```

Make sure the new case sits OUTSIDE the grouped fallthrough so its body is reached.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test apps/server/src/orchestration/weaveProjector.test.ts`
Expected: PASS for the new test.

Run: `bun run test apps/server/src/orchestration/projector` (loose match — runs all projector tests)
Expected: PASS — no regressions in existing projector tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts apps/server/src/orchestration/weaveProjector.test.ts apps/server/src/orchestration/projector.ts
git commit -m "feat(server): projector hard-removes weave run on weave.deleted"
```

---

## Task 4: Server WS shell stream — emit `weave-run-removed`

**Files:**

- Modify: `apps/server/src/ws.ts:300-362` (extend the shell-stream event projection)

- [ ] **Step 1: Add the case to the shell-stream projection**

In [apps/server/src/ws.ts](apps/server/src/ws.ts), the shell-stream event projection switch starts at line 302. Add a `case "weave.deleted"` arm BEFORE the existing `default:` (which currently handles all weave events generically). The new case mirrors the `thread.deleted` case (line 323-330):

```ts
case "thread.deleted":
  return Effect.succeed(
    Option.some({
      kind: "thread-removed" as const,
      sequence: event.sequence,
      threadId: event.payload.threadId,
    }),
  );
case "weave.deleted":
  return Effect.succeed(
    Option.some({
      kind: "weave-run-removed" as const,
      sequence: event.sequence,
      weaveRunId: event.payload.weaveRunId,
    }),
  );
default:
  if (event.aggregateKind === "weave") {
    // ... unchanged
```

The existing `default` weave branch reads `readModel.weaveRuns.get(runId)` and emits `weave-run-upserted`. For `weave.deleted` the projection is gone after the projector runs, so the lookup would return `undefined` and the event would be silently dropped — surfacing the explicit `weave-run-removed` is required.

- [ ] **Step 2: Add an integration test**

In [apps/server/src/ws.weave.test.ts](apps/server/src/ws.weave.test.ts), append a new describe block at the end of the file:

```ts
describe("weave.delete dispatch removes the run from the read model", () => {
  it("dispatches weave.delete and the projection becomes null", async () => {
    const system = await createOrchestrationSystem();
    try {
      const weaveRunId = WeaveRunId.make("delete-test-run");
      const projectId = ProjectId.make("delete-test-project");

      await system.run(
        system.engine.dispatch({
          type: "weave.create",
          commandId: CommandId.make("cmd-create-del"),
          weaveRunId,
          projectId,
          title: "To be deleted",
          vision: "",
          createdAt: now(),
        }),
      );

      const before = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
      expect(before).not.toBeNull();

      const result = await system.run(
        system.engine.dispatch({
          type: "weave.delete",
          commandId: CommandId.make("cmd-delete"),
          weaveRunId,
          createdAt: now(),
        }),
      );
      expect(result.sequence).toBeGreaterThan(0);

      const after = await system.run(system.weaveEngine.getWeaveRun(weaveRunId));
      expect(after).toBeNull();
    } finally {
      await system.dispose();
    }
  });

  it("rejects weave.delete for a non-existent run", async () => {
    const system = await createOrchestrationSystem();
    try {
      await expect(
        system.run(
          system.engine.dispatch({
            type: "weave.delete",
            commandId: CommandId.make("cmd-delete-missing"),
            weaveRunId: WeaveRunId.make("never-existed"),
            createdAt: now(),
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await system.dispose();
    }
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `bun run test apps/server/src/ws.weave.test.ts`
Expected: PASS — both new tests succeed.

- [ ] **Step 4: Run server-wide test sweep**

Run: `bun run test apps/server`
Expected: PASS — no regressions. If failures appear in `weaveIntegration.test.ts`, `OrchestrationEngine.test.ts`, or `ProjectionPipeline.test.ts`, investigate: those tests may iterate exhaustively over event types and need a `weave.deleted` arm.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws.ts apps/server/src/ws.weave.test.ts
git commit -m "feat(server): WS shell stream emits weave-run-removed on weave.deleted"
```

---

## Task 5: Web store — clean `weaveRunDetailById` on `weave-run-removed`

**Files:**

- Modify: `apps/web/src/store.ts:1901-1904` (extend the `weave-run-removed` reducer)
- Modify: `apps/web/src/orchestrationEventEffects.ts:67-79` (add `weave.deleted` to the exhaustive weave switch)

- [ ] **Step 1: Write the failing test**

In [apps/web/src/store.test.ts](apps/web/src/store.test.ts), append a new `describe` block at the end of the file. The test seeds both maps with an entry, dispatches `weave-run-removed`, and asserts both are cleared. The exported entrypoint is `applyShellEvent` (defined in [apps/web/src/store.ts:2093](apps/web/src/store.ts:2093)). Add the import to the existing import block from `./store`:

```ts
import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  applyShellEvent,
  // …existing imports…
} from "./store";
import { WeaveRunId } from "@t3tools/contracts";
```

(Add `WeaveRunId` to the `@t3tools/contracts` import block — it is not currently imported in this file.)

Then add the test:

```ts
describe("applyShellEvent — weave-run-removed", () => {
  it("clears both weaveRunsById and weaveRunDetailById entries for the run", () => {
    const weaveRunId = WeaveRunId.make("run-to-delete");
    const projectId = ProjectId.make("project-1");
    const seedShell = {
      id: weaveRunId,
      projectId,
      title: "doomed",
      status: "draft" as const,
      pendingCount: 0,
      readyCount: 0,
      runningCount: 0,
      verifiedCount: 0,
      failedCount: 0,
      createdAt: "2026-05-01T00:00:00.000Z" as never,
      updatedAt: "2026-05-01T00:00:00.000Z" as never,
    };
    const seedDetail = {
      run: {
        id: weaveRunId,
        projectId,
        title: "doomed",
        vision: "",
        status: "draft" as const,
        concurrencyCap: 1 as never,
        planningDepthCap: 3 as never,
        createdAt: "2026-05-01T00:00:00.000Z" as never,
      },
      currentBlueprint: null,
      nodeMeta: new Map(),
      openDecisions: new Set(),
      autoDecisionLog: [],
      phaseApprovals: new Map(),
      childThreads: new Map(),
    };

    const seeded = makeEmptyState({
      weaveRunsById: { [weaveRunId]: seedShell },
      weaveRunDetailById: { [weaveRunId]: seedDetail },
    });

    expect(localEnvironmentStateOf(seeded).weaveRunsById[weaveRunId]).toBeDefined();
    expect(localEnvironmentStateOf(seeded).weaveRunDetailById[weaveRunId]).toBeDefined();

    const next = applyShellEvent(
      seeded,
      { kind: "weave-run-removed", sequence: 1 as never, weaveRunId },
      localEnvironmentId,
    );

    expect(localEnvironmentStateOf(next).weaveRunsById[weaveRunId]).toBeUndefined();
    expect(localEnvironmentStateOf(next).weaveRunDetailById[weaveRunId]).toBeUndefined();
  });
});
```

If a type cast is needed for any branded field (e.g. `IsoDateTime`), prefer the helper used in nearby tests (search the file for `IsoDateTime.make` first) — only fall back to `as never` if no helper exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/web/src/store.test.ts`
Expected: FAIL — `weaveRunDetailById` still contains the deleted run.

- [ ] **Step 3: Update the reducer**

In [apps/web/src/store.ts](apps/web/src/store.ts), modify the `weave-run-removed` case (line 1901-1904) to also clear the detail map:

```ts
case "weave-run-removed": {
  const { [event.weaveRunId]: _shell, ...remainingShells } = state.weaveRunsById;
  const { [event.weaveRunId]: _detail, ...remainingDetails } = state.weaveRunDetailById;
  return {
    ...state,
    weaveRunsById: remainingShells,
    weaveRunDetailById: remainingDetails,
  };
}
```

Note: the surrounding function operates on `EnvironmentState`, not the top-level `AppState` — verify by reading `apps/web/src/store.ts:1880-1906` before editing. Adapt the destructuring to whichever object owns the maps in the local scope.

- [ ] **Step 4: Add `weave.deleted` to the orchestration event effects switch**

In [apps/web/src/orchestrationEventEffects.ts](apps/web/src/orchestrationEventEffects.ts), append `case "weave.deleted":` to the grouped no-op weave block (after `case "weave.exited":` at line 77):

```ts
case "weave.created":
case "weave.blueprint-compiled":
case "weave.blueprint-approved":
case "weave.node-dispatched":
case "weave.node-verified":
case "weave.node-failed":
case "weave.decision-resolved":
case "weave.phase-approved":
case "weave.exited":
case "weave.deleted": {
  break;
}
```

This keeps the switch exhaustive without producing any side effects: the shell stream's `weave-run-removed` already drives the cleanup.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test apps/web/src/store.test.ts`
Expected: PASS — the new assertion holds.

- [ ] **Step 6: Run typecheck**

Run: `bun typecheck`
Expected: PASS — no exhaustiveness errors anywhere.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/store.ts apps/web/src/store.test.ts apps/web/src/orchestrationEventEffects.ts
git commit -m "feat(web): clear weave run detail on weave-run-removed; handle weave.deleted in event effects"
```

---

## Task 6: Web — delete button in `WeaveExecutionHeader`

**Files:**

- Modify: `apps/web/src/components/weave/WeaveExecutionHeader.tsx` (current contents in full at the file path; full rewrite below)
- Modify: `apps/web/src/components/weave/WeaveView.tsx:24-44` (pass new props)

- [ ] **Step 1: Write the failing test**

Create [apps/web/src/components/weave/WeaveExecutionHeader.test.tsx](apps/web/src/components/weave/WeaveExecutionHeader.test.tsx):

```tsx
import { EnvironmentId, WeaveRunId, type OrchestrationWeaveRunShell } from "@t3tools/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { WeaveExecutionHeader } from "./WeaveExecutionHeader";
import * as dispatchModule from "../../weave/dispatchWeaveCommand";

// OrchestrationWeaveRunShell shape (verified against
// packages/contracts/src/orchestration.ts:424-436):
const baseShell: OrchestrationWeaveRunShell = {
  id: WeaveRunId.make("run-1"),
  projectId: ProjectId.make("project-1"),
  title: "My weave" as never, // TrimmedNonEmptyString brand
  status: "running",
  pendingCount: 0 as never, // NonNegativeInt brand
  readyCount: 0 as never,
  runningCount: 1 as never,
  verifiedCount: 2 as never,
  failedCount: 0 as never,
  createdAt: "2026-05-01T00:00:00.000Z" as never,
  updatedAt: "2026-05-01T00:00:00.000Z" as never,
};

const environmentId = EnvironmentId.make("env-1");

describe("WeaveExecutionHeader — delete button", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a confirmation dialog when the delete button is clicked", async () => {
    render(
      <WeaveExecutionHeader shell={baseShell} environmentId={environmentId} onDeleted={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /delete weave/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("does not dispatch when cancel is clicked", async () => {
    const dispatch = vi
      .spyOn(dispatchModule, "dispatchWeaveCommand")
      .mockResolvedValue({ sequence: 1 });
    const onDeleted = vi.fn();
    render(
      <WeaveExecutionHeader
        shell={baseShell}
        environmentId={environmentId}
        onDeleted={onDeleted}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /delete weave/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("dispatches weave.delete and calls onDeleted on confirm", async () => {
    const dispatch = vi
      .spyOn(dispatchModule, "dispatchWeaveCommand")
      .mockResolvedValue({ sequence: 1 });
    const onDeleted = vi.fn();
    render(
      <WeaveExecutionHeader
        shell={baseShell}
        environmentId={environmentId}
        onDeleted={onDeleted}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /delete weave/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      environmentId,
      expect.objectContaining({ type: "weave.delete", weaveRunId: baseShell.id }),
    );
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
```

If `OrchestrationWeaveRunShell` has additional required fields beyond what is shown above, fill them with realistic defaults rather than leaving the cast as `as OrchestrationWeaveRunShell`. Inspect [packages/contracts/src/orchestration.ts](packages/contracts/src/orchestration.ts) for the full `OrchestrationWeaveRunShell` definition before fleshing out `baseShell`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/web/src/components/weave/WeaveExecutionHeader.test.tsx`
Expected: FAIL — the delete button does not yet exist.

- [ ] **Step 3: Replace `WeaveExecutionHeader.tsx`**

Rewrite [apps/web/src/components/weave/WeaveExecutionHeader.tsx](apps/web/src/components/weave/WeaveExecutionHeader.tsx) to add the delete button + dialog. Keep the existing layout intact:

```tsx
import { CommandId, type EnvironmentId, type OrchestrationWeaveRunShell } from "@t3tools/contracts";
import { useState } from "react";

import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";
import { newCommandId } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export interface WeaveExecutionHeaderProps {
  readonly shell: OrchestrationWeaveRunShell;
  readonly environmentId: EnvironmentId;
  readonly onDeleted: () => void;
}

export function WeaveExecutionHeader({
  shell,
  environmentId,
  onDeleted,
}: WeaveExecutionHeaderProps) {
  const total =
    shell.pendingCount +
    shell.readyCount +
    shell.runningCount +
    shell.verifiedCount +
    shell.failedCount;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirmDelete = async () => {
    setSubmitting(true);
    try {
      await dispatchWeaveCommand(environmentId, {
        type: "weave.delete",
        commandId: newCommandId(),
        weaveRunId: shell.id,
        createdAt: new Date().toISOString(),
      });
      setConfirmOpen(false);
      onDeleted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <header className="border-b border-border flex items-center justify-between gap-4 px-6 py-4 min-w-0">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <h1 className="text-xl font-semibold truncate min-w-0">{shell.title}</h1>
        <span className="text-sm text-muted-foreground shrink-0">{shell.status}</span>
      </div>
      <div className="flex items-center gap-6 text-xs shrink-0">
        <Stat label="Verified" value={shell.verifiedCount} color="text-green-600" />
        <Stat label="Running" value={shell.runningCount} color="text-amber-600" />
        <Stat label="Ready" value={shell.readyCount} color="text-blue-600" />
        <Stat label="Failed" value={shell.failedCount} color="text-red-600" />
        <Stat label="Pending" value={shell.pendingCount} color="text-muted-foreground" />
        <Stat label="Total" value={total} />
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
        <div className="border-l border-border pl-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete weave"
          >
            Delete weave
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete weave "{shell.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the weave run from your environment. Child threads created by the weave
              (planner, dispatched nodes) will remain and must be deleted separately if you no
              longer need them. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={submitting}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
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

Implementation note: `newCommandId` is exported from [apps/web/src/lib/utils.ts](apps/web/src/lib/utils.ts) (verified — the same import is used in [apps/web/src/components/CommandPalette.tsx:65](apps/web/src/components/CommandPalette.tsx:65) via the `~/lib/utils` alias and in [apps/web/src/components/BranchToolbarBranchSelector.tsx:21](apps/web/src/components/BranchToolbarBranchSelector.tsx:21) via the relative `../lib/utils` path). Use whichever style matches the surrounding imports in `WeaveExecutionHeader.tsx`. The `Button` component is the local shadcn-style wrapper — confirm the path via `grep -n "import { Button" apps/web/src/components/ProjectScriptsControl.tsx` and reuse it.

- [ ] **Step 4: Update `WeaveView.tsx` to pass the new props**

In [apps/web/src/components/weave/WeaveView.tsx](apps/web/src/components/weave/WeaveView.tsx), modify the `<WeaveExecutionHeader>` invocation (line 55) to pass `environmentId` and an `onDeleted` callback that navigates to the environment root:

```tsx
<WeaveExecutionHeader
  shell={shell}
  environmentId={props.environmentId}
  onDeleted={() => {
    void navigate({
      to: "/$environmentId",
      params: { environmentId: props.environmentId },
      replace: true,
    });
  }}
/>
```

Note: confirm the route path `/$environmentId` exists by inspecting the route files in `apps/web/src/routes/`. If the canonical "after-delete fallback" path is different (for example the same path used after `thread.delete` in `useThreadActions.ts:200` which is just `/`), use that one instead. Read [apps/web/src/hooks/useThreadActions.ts:160-210](apps/web/src/hooks/useThreadActions.ts:160) for the prior art and mirror it.

- [ ] **Step 5: Run the component test**

Run: `bun run test apps/web/src/components/weave/WeaveExecutionHeader.test.tsx`
Expected: PASS.

- [ ] **Step 6: Type-check the web app**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 7: Smoke-test in a browser**

Start the dev server (the standard launch command for this repo — confirm via `package.json` scripts). Manually:

1. Create a weave run.
2. Open it; the header should show the new "Delete weave" button.
3. Click it → dialog appears with the warning copy.
4. Click "Cancel" → dialog closes; nothing else changes.
5. Click "Delete weave" → "Delete" → user is navigated away; the weave is gone from the sidebar / environment list.
6. Repeat for runs in `draft`, `reviewing`, `running`, and `complete` states (deletion should be allowed in each).

Document any UI rough edges (button placement at narrow widths, focus management on dialog close) and either fix them inline or capture as a follow-up note.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/weave/WeaveExecutionHeader.tsx apps/web/src/components/weave/WeaveExecutionHeader.test.tsx apps/web/src/components/weave/WeaveView.tsx
git commit -m "feat(weave-web): add delete weave button with confirmation dialog"
```

---

## Task 7: Final verification and cleanup

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full task-completion suite**

Run, in order:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Each must pass before the work is considered complete (per `AGENTS.md`).

- [ ] **Step 2: Search for any leftover TODOs or unhandled cases**

Run: `grep -rn "weave.deleted\|weave.delete" apps packages --include='*.ts' --include='*.tsx'`
Expected: every match is either an intentional implementation site or a test. No `TODO`, `FIXME`, or `not yet implemented` markers tied to delete should remain.

- [ ] **Step 3: Verify no exhaustiveness regressions**

Inspect each switch on `event.type` / `command.type` touched by this plan and confirm the new event/command is either explicitly handled or grouped into an existing no-op fallthrough:

- `apps/server/src/orchestration/weaveDecider.ts` — explicit `case "weave.delete"`
- `apps/server/src/orchestration/decider.ts` — `weave.delete` in fallthrough
- `apps/server/src/orchestration/projector.ts` — explicit `case "weave.deleted"` BEFORE the grouped fallthrough
- `apps/server/src/orchestration/weaveProjector.ts` — defensive `case "weave.deleted"`
- `apps/server/src/ws.ts` — explicit `case "weave.deleted"` shell-stream arm
- `apps/web/src/store.ts` — `weave.deleted` either ignored in the per-event detail patcher (default path) or explicitly handled if a switch demands it
- `apps/web/src/orchestrationEventEffects.ts` — `case "weave.deleted":` in the no-op group

- [ ] **Step 4: Final commit (only if any tidy-ups were made)**

```bash
git add -A # use specific paths if any tidy-ups were made
git commit -m "chore(weave): finalize delete button task"
```

If no further changes are required, skip this step.

---

## Notes for the implementer

- **Scope discipline:** Do not introduce a `WeaveRun.deletedAt` field, do not add a soft-delete reactor, and do not cascade-delete child threads or worktrees. Those would all be valid future enhancements but they are out of scope here.
- **Exhaustiveness is the implicit test suite:** TypeScript's `_exhaustive: never` patterns in this codebase will surface any missed switch case at type-check time. Keep `bun typecheck` green at every commit and the surface area stays correct.
- **Allow delete in any state:** The decider deliberately omits `requireRunNotTerminal` because the user must be able to clean up `complete`/`aborted` runs. The dialog copy already warns about live child threads.
- **No race-condition concerns from in-flight events:** After the projector removes the run from `weaveRuns`, the conformer (`WeaveContractConformer.ts`) and scheduler (`WeaveScheduler.ts`) both look up runs via `weaveRuns.get(...)` and exit early on `null`. Any subsequent decider commands for the run will fail `requireRun({ projection })`.
