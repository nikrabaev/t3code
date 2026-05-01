# Weave Phase Planner Live Dispatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-30-weave-incremental-planning-design.md`](../specs/2026-04-30-weave-incremental-planning-design.md) — fills the "live `PhasePlannerDriver` Layer" gap explicitly deferred from Slice 3 (line 25 of the Slice 3 plan), Slice 4 ("Two pieces remain", line 1395 of the Slice 4 plan), and Slice 5.

**Bug context:** Slices 1–5 wired schemas, the meta-planner, the Phase Planner prompt builder, the conformer's planning JSON-decode path, the decider/projector arms for `weave.blueprint.extend`, the scheduler's kind-stratified ready check, and the web UI. **They left one piece unplugged:** when a Planning Node dispatches today, the agent receives `formatNodeSpec(node)` — the generic Task prompt — with no JSON instructions, no Vision, no codebase snapshot. The agent does what looks reasonable for "Plan Phase 1: Scaffolding": writes a markdown plan. The conformer's `processPlanningNode` ([`WeaveContractConformer.ts:200`](../../../apps/server/src/orchestration/Layers/WeaveContractConformer.ts:200)) calls `JSON.parse` on that markdown and the node fails with `planning JSON parse failed: …`. The function `buildPhasePlannerPrompt` exists in [`plannerPrompt.ts:119`](../../../apps/server/src/orchestration/Layers/plannerPrompt.ts:119) but has zero call sites outside its own test file.

**Goal:** Wire `buildPhasePlannerPrompt` into the `WeaveScheduler` and `WeaveNodeRestarter` dispatch paths so Planning Node child agents receive structured JSON-only instructions and emit `PhasePlannerOutput`-shaped JSON that the conformer can decode.

**Architecture:** Single source-file change of substance. Add an exported `formatPlanningNodeSpec(node, blueprint, run)` helper alongside the existing `formatNodeSpec(node)` in [`WeaveScheduler.ts`](../../../apps/server/src/orchestration/Layers/WeaveScheduler.ts). The helper looks up the phase by `node.phaseId` from the blueprint and calls `buildPhasePlannerPrompt` with the run's `vision`/`snapshotContent`, the phase's `title`/`description`, and the planner node's `description`. Both dispatch sites — the scheduler's `processSchedulerDecision` and the restarter's `processItem` — branch on `node.kind === "planning"`: planning nodes get the new helper's output as the user message text; everything else keeps `formatNodeSpec`. The conformer's existing `processPlanningNode` path (Slice 3) already validates the resulting JSON. No new Layer, no new Service, no schema change, no decider/projector change.

**Tech Stack:** Effect 4 beta, vitest, bun.

---

## Out of scope

- **Renaming `WeavePlanner → MetaPlanner` and adding a separate `PhasePlanner` service.** Cosmetic; deferred since Slice 3.
- **Re-snapshotting the worktree before sending the prompt.** Use the static `run.snapshotContent` captured at intake. The agent has worktree filesystem access and can inspect repo state with its own tools when it needs more than the intake snapshot.
- **Mid-Phase Planning Node recursion / `planningDepthCap` enforcement at dispatch.** Slice 3 already rejects `kind: "planning"` inside `addedNodes`; depth-tracking and recursive emissions are a separate slice.
- **Web UI changes.** Slice 5 already renders `kind: "planning"` Nodes and surfaces multi-gate approvals.
- **Conformer source code.** Slice 3's planning JSON path is correct and consumes the JSON this plan makes the agent emit.
- **`plannerPrompt.ts`.** Slice 3's `buildPhasePlannerPrompt` is correct; only its call site changes.
- **Decider, projector, contract schemas.** All untouched.
- **A full `WeaveNodeRestarter.test.ts` integration harness.** Would require new Layer wiring; the restarter's change is a one-branch edit covered by code review plus the unit test on the shared helper.
- **Re-enabling or rewriting `weaveIntegration.test.ts`.** That test is already enabled by Slice 4 and stubs the Phase Planner output — it does not exercise the live prompt.

## Definition of done

- The `WeaveScheduler` dispatches `kind === "planning"` Nodes with a user message text containing the JSON output instructions (literal substring `"addedNodes"`) and the planner node's `phaseId`.
- The `WeaveNodeRestarter` retries `kind === "planning"` Nodes with that same Phase Planner prompt text.
- Tasks (`raw`/`scaffold`/`contract`/`utility`) keep using `formatNodeSpec` unchanged — both at initial dispatch and on retry.
- New unit tests for `formatPlanningNodeSpec` (pure function) cover: passes vision through, passes snapshotContent through, falls back to `(empty)` when snapshotContent is undefined, includes the planner node's description, includes the `phaseId` in the output, throws on missing phase.
- New scheduler-integration test asserts that an end-to-end planning-node dispatch produces a `thread.message-sent` event whose `text` contains the JSON instructions and the planner node's `phaseId`.
- `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` all pass with no new failures beyond the existing branch baseline.
- Three small focused commits — one per task plus a verification commit if needed.

---

## File structure

| File                                                          | Change                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/orchestration/Layers/WeaveScheduler.ts`      | Add new exported `formatPlanningNodeSpec(node, blueprint, run)` helper. Add kind-aware branch in `processSchedulerDecision` around line 293–306 (the `thread.turn.start` dispatch). New imports: `buildPhasePlannerPrompt`, `Blueprint`, `WeaveRun`.                                 |
| `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` | Append a new top-level `describe("formatPlanningNodeSpec", …)` block (pure-function tests) and a new `describe("WeaveScheduler — planning node dispatch", …)` block (one integration test that drives a 1-Phase planning-only blueprint and asserts the `thread.message-sent` text). |
| `apps/server/src/orchestration/Layers/WeaveNodeRestarter.ts`  | Branch on `node.kind === "planning"`: use `formatPlanningNodeSpec`; else `formatNodeSpec`. Restructure the early-return so TypeScript narrows `blueprint` to non-null on the planning branch.                                                                                        |

`apps/server/src/orchestration/Layers/plannerPrompt.ts` is **not** modified — Slice 3's prompt builder is correct.
`apps/server/src/orchestration/Layers/WeaveContractConformer.ts` is **not** modified — Slice 3's `processPlanningNode` is correct.
`apps/server/src/orchestration/weaveDecider.ts`, `apps/server/src/orchestration/weaveProjector.ts` are **not** modified.
Contract schemas (`packages/contracts/src/weave.ts`, `packages/contracts/src/orchestration.ts`) are **not** modified.

---

## Task 1: Add `formatPlanningNodeSpec` helper with unit tests

**Files:**

- Modify: `apps/server/src/orchestration/Layers/WeaveScheduler.ts` (add new exported function alongside `formatNodeSpec` at lines 147–156; add new imports at the top)
- Modify: `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` (append a new top-level `describe` block at the end of the file)

**Why this matters:** Both dispatch sites (the scheduler in Task 2 and the restarter in Task 3) need to call the same helper, and the helper has enough logic (phase lookup, defaulting, throwing on missing phase) that it deserves direct unit tests. Extracting it before either call site is wired keeps Task 2 and Task 3 mechanical.

- [ ] **Step 1: Write the failing helper tests**

Append at the end of `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` (after the closing `});` of the existing `describe("WeaveScheduler", …)` block):

```typescript
import { formatPlanningNodeSpec } from "./WeaveScheduler.ts";

describe("formatPlanningNodeSpec", () => {
  function makePlanningNode(params: { id?: string; phaseId?: string; description?: string } = {}) {
    const phaseId = WeavePhaseId.make(params.phaseId ?? "phase-1");
    const nodeId = WeaveNodeId.make(params.id ?? "plan-phase-1");
    return Schema.decodeSync(
      Schema.Struct({
        id: WeaveNodeId,
        title: Schema.String,
        description: Schema.String,
        kind: Schema.Literal("planning"),
        phaseId: WeavePhaseId,
        scope: Schema.Struct({
          readSet: Schema.Array(Schema.String),
          writeSet: Schema.Array(Schema.String),
        }),
        inputContractIds: Schema.Array(Schema.String),
        outputContractIds: Schema.Array(Schema.String),
        verifierDescription: Schema.String,
        dependsOn: Schema.Array(WeaveNodeId),
        status: Schema.Literal("pending"),
      }),
    )({
      id: nodeId,
      title: "Plan Phase 1",
      description: params.description ?? "Plan the scaffolding sub-tasks for Phase 1",
      kind: "planning",
      phaseId,
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "PhasePlannerOutput JSON",
      dependsOn: [],
      status: "pending",
    });
  }

  function makePlanningBlueprint(
    params: { phaseId?: string; phaseTitle?: string; phaseDescription?: string } = {},
  ): Blueprint {
    const phaseId = WeavePhaseId.make(params.phaseId ?? "phase-1");
    return Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: WeaveNodeId.make("plan-phase-1"),
          title: "Plan Phase 1",
          description: "Plan the scaffolding sub-tasks for Phase 1",
          kind: "planning",
          phaseId,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "PhasePlannerOutput JSON",
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        {
          id: phaseId,
          ordinal: 0,
          title: params.phaseTitle ?? "Phase 1: Scaffolding",
          description: params.phaseDescription ?? "Stand up the project skeleton",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now(),
      compiledBy: "planner",
    });
  }

  it("passes vision through to the prompt", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint();
    const text = formatPlanningNodeSpec(node, blueprint, {
      vision: "Build a minimal todo app",
    });
    expect(text).toContain("Build a minimal todo app");
  });

  it("passes snapshotContent through to the prompt", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint();
    const text = formatPlanningNodeSpec(node, blueprint, {
      vision: "ignored here",
      snapshotContent: "FILE_TREE_HERE",
    });
    expect(text).toContain("FILE_TREE_HERE");
  });

  it("falls back to '(empty)' when snapshotContent is undefined", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint();
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("(empty)");
  });

  it("includes the planner node's description", () => {
    const node = makePlanningNode({
      description: "Plan the database migration tasks for this phase.",
    });
    const blueprint = Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: node.id,
          title: node.title,
          description: node.description,
          kind: "planning",
          phaseId: node.phaseId,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: node.verifierDescription,
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        {
          id: node.phaseId,
          ordinal: 0,
          title: "Phase 1",
          description: "x",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now(),
      compiledBy: "planner",
    });
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("Plan the database migration tasks for this phase.");
  });

  it("includes the planner's phaseId in the prompt template", () => {
    const node = makePlanningNode({ phaseId: "phase-42" });
    const blueprint = makePlanningBlueprint({ phaseId: "phase-42" });
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("phase-42");
  });

  it("includes the looked-up phase title and description", () => {
    const node = makePlanningNode();
    const blueprint = makePlanningBlueprint({
      phaseTitle: "PHASE_TITLE_MARKER",
      phaseDescription: "PHASE_DESCRIPTION_MARKER",
    });
    const text = formatPlanningNodeSpec(node, blueprint, { vision: "v" });
    expect(text).toContain("PHASE_TITLE_MARKER");
    expect(text).toContain("PHASE_DESCRIPTION_MARKER");
  });

  it("throws when the phase is missing from the blueprint", () => {
    const node = makePlanningNode({ phaseId: "phase-orphan" });
    // Blueprint with phase id "phase-1", but node references "phase-orphan".
    // Note: the Blueprint schema may reject this construction depending on
    // cross-field validation; if so, build the blueprint with phase "phase-orphan"
    // first and then mutate the node's phaseId via a separate decode that uses
    // a different phase id. The point of the test is that formatPlanningNodeSpec
    // throws when blueprint.phases.find(p => p.id === node.phaseId) returns
    // undefined. If the schema enforces consistency, this test can instead
    // construct the inputs directly without round-tripping through Schema.
    const orphanNode = { ...node, phaseId: WeavePhaseId.make("does-not-exist") };
    const blueprint = makePlanningBlueprint({ phaseId: "phase-1" });
    expect(() =>
      formatPlanningNodeSpec(orphanNode as typeof node, blueprint, { vision: "v" }),
    ).toThrow(/unknown phase|does-not-exist/);
  });
});
```

Add the missing import at the top of the test file (next to existing imports from `@t3tools/contracts`):

```typescript
import { Blueprint } from "@t3tools/contracts";
```

(`Blueprint`, `BlueprintVersion`, `WeaveNodeId`, `WeavePhaseId`, `Schema` are already imported by the existing test file — verify before adding `Blueprint` only if it's not already imported.)

- [ ] **Step 2: Run the failing tests**

Run: `cd apps/server && bun test src/orchestration/Layers/WeaveScheduler.test.ts -t "formatPlanningNodeSpec"`

Expected: FAIL — `formatPlanningNodeSpec is not exported from WeaveScheduler.ts` or `formatPlanningNodeSpec is not a function`. (Vitest's exact message depends on the runner; a `SyntaxError` at import time is also acceptable.)

- [ ] **Step 3: Implement the helper**

In `apps/server/src/orchestration/Layers/WeaveScheduler.ts`, add the import (next to existing imports from `@t3tools/contracts`):

```typescript
import type {
  Blueprint,
  WeaveNode,
  WeaveNodeId,
  WeaveRun,
  WeaveRunProjection,
} from "@t3tools/contracts";
```

Add the import at the top (next to other Layer-relative imports):

```typescript
import { buildPhasePlannerPrompt } from "./plannerPrompt.ts";
```

Insert the new function directly above `formatNodeSpec` (around line 147):

```typescript
/**
 * Format the user message text for a `kind: "planning"` Node dispatch.
 *
 * Builds a structured Phase Planner prompt via `buildPhasePlannerPrompt`,
 * which instructs the agent to emit a `PhasePlannerOutput` JSON object — the
 * conformer's `processPlanningNode` then parses and validates that JSON to
 * dispatch `weave.blueprint.extend`.
 *
 * Looks up the planner node's phase from the blueprint by `node.phaseId`.
 * Throws if the phase is missing, which would only happen if the blueprint
 * is internally inconsistent (the schema and decider both prevent this).
 *
 * Exported so the WeaveNodeRestarter reactor can call the same helper when
 * re-dispatching a Planning Node on retry.
 */
export function formatPlanningNodeSpec(
  node: WeaveNode,
  blueprint: Blueprint,
  run: { readonly vision: string; readonly snapshotContent?: string | undefined },
): string {
  const phase = blueprint.phases.find((p) => p.id === node.phaseId);
  if (phase === undefined) {
    throw new Error(
      `formatPlanningNodeSpec: planning node '${node.id}' references unknown phase '${node.phaseId}'`,
    );
  }
  return buildPhasePlannerPrompt({
    vision: run.vision,
    snapshotContent: run.snapshotContent ?? "",
    phaseTitle: phase.title,
    phaseDescription: phase.description,
    plannerNodeDescription: node.description,
    plannerPhaseId: node.phaseId,
  });
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `cd apps/server && bun test src/orchestration/Layers/WeaveScheduler.test.ts -t "formatPlanningNodeSpec"`

Expected: PASS — all 7 tests in the new `describe("formatPlanningNodeSpec", …)` block pass. The pre-existing `describe("WeaveScheduler", …)` tests should also still pass because Task 1 only adds code; the dispatch path is unchanged.

- [ ] **Step 5: Commit**

```bash
cd apps/server
git add src/orchestration/Layers/WeaveScheduler.ts src/orchestration/Layers/WeaveScheduler.test.ts
git commit -m "feat(weave): add formatPlanningNodeSpec helper for Phase Planner prompts"
```

---

## Task 2: Wire the helper into `WeaveScheduler` dispatch

**Files:**

- Modify: `apps/server/src/orchestration/Layers/WeaveScheduler.ts:293–306` (the `thread.turn.start` dispatch inside `processSchedulerDecision`)
- Modify: `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` (append one integration test inside or after the existing `describe("WeaveScheduler", …)` block)

**Why this matters:** Today the scheduler always sends `formatNodeSpec(next)` as the user message, including for `kind: "planning"` nodes. That generic prompt has no JSON instructions, so the agent emits markdown and the conformer's JSON parse fails. After this task, planning dispatches use `formatPlanningNodeSpec`; everything else keeps `formatNodeSpec`. The integration test exercises the end-to-end "approve a planning-only blueprint → dispatch fires → message-sent event carries the structured prompt" path so the scheduler change is observably tied to a real event the rest of the system reacts to.

- [ ] **Step 1: Write the failing integration test**

Append the following inside the existing `describe("WeaveScheduler", …)` block in `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` (right before the closing `});` of that `describe`):

```typescript
it("dispatches kind === 'planning' nodes with a Phase Planner prompt as the user message", async () => {
  const projectId = "project-sched-planning";
  const runId = "run-sched-planning";
  const system = await createSchedulerSystem("t3-weave-sched-planning-");
  const { scheduler, weaveEngine, orchestrationEngine } = system;

  await system.run(
    Effect.scoped(
      Effect.gen(function* () {
        yield* scheduler.start();
        yield* Effect.sleep("20 millis");

        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`cmd-project-${projectId}`),
          projectId: asProjectId(projectId),
          title: "Test Project",
          workspaceRoot: FAKE_WORKSPACE_ROOT,
          defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
          createdAt: now(),
        });

        // Build a 1-Phase, 1-Planning-Node blueprint.
        const phaseId = WeavePhaseId.make("phase-42");
        const plannerNodeId = WeaveNodeId.make("plan-phase-42");
        const blueprint = Schema.decodeSync(Blueprint)({
          version: BlueprintVersion.make(1),
          nodes: [
            {
              id: plannerNodeId,
              title: "Plan Phase 42",
              description: "PLANNER_NODE_DESCRIPTION_MARKER",
              kind: "planning",
              phaseId,
              scope: { readSet: [], writeSet: [] },
              inputContractIds: [],
              outputContractIds: [],
              verifierDescription: "PhasePlannerOutput JSON",
              dependsOn: [],
              status: "pending",
            },
          ],
          phases: [
            {
              id: phaseId,
              ordinal: 0,
              title: "PHASE_TITLE_MARKER",
              description: "PHASE_DESCRIPTION_MARKER",
              approval: "pending",
            },
          ],
          contracts: [],
          decisions: [],
          compiledAt: now(),
          compiledBy: "planner",
        });

        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.create",
          commandId: CommandId.make(`cmd-create-${runId}`),
          weaveRunId: WeaveRunId.make(runId),
          projectId: asProjectId(projectId),
          title: "Phase Planning Test",
          vision: "VISION_MARKER",
          snapshotContent: "SNAPSHOT_MARKER",
          createdAt: now(),
        });

        yield* weaveEngine.persistPlannerEvent({
          runId: WeaveRunId.make(runId),
          blueprint,
          compiledBy: "planner",
        });

        yield* weaveEngine.dispatchWeaveCommand({
          type: "weave.blueprint.approve",
          commandId: CommandId.make(`cmd-approve-${runId}`),
          weaveRunId: WeaveRunId.make(runId),
          blueprintVersion: blueprint.version,
          concurrencyCap: 1,
          createdAt: now(),
        });

        yield* scheduler.drain;
      }),
    ),
  );

  // Confirm the planning node was dispatched (status running, child thread
  // allocated).
  const projection = await system.run(weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
  expect(projection?.nodeMeta.get(WeaveNodeId.make("plan-phase-42"))?.status).toBe("running");
  const childThreadId = projection?.childThreads.get(WeaveNodeId.make("plan-phase-42"))?.threadId;
  expect(childThreadId).toBeDefined();

  // Find the user message-sent event for the child thread and assert its text
  // contains the Phase Planner prompt's distinguishing markers.
  const allEvents = await system.run(Stream.runCollect(orchestrationEngine.readEvents(0)));
  const userMessageEvent = Array.from(allEvents).find(
    (e) =>
      e.type === "thread.message-sent" &&
      e.payload.threadId === childThreadId &&
      e.payload.role === "user",
  );
  expect(userMessageEvent).toBeDefined();
  if (userMessageEvent === undefined || userMessageEvent.type !== "thread.message-sent") {
    throw new Error("user message-sent event missing");
  }
  const text = userMessageEvent.payload.text;

  // Phase Planner prompt distinguishing markers.
  expect(text).toContain("Phase Planner");
  expect(text).toContain('"addedNodes"');
  expect(text).toContain("phase-42");
  expect(text).toContain("VISION_MARKER");
  expect(text).toContain("SNAPSHOT_MARKER");
  expect(text).toContain("PHASE_TITLE_MARKER");
  expect(text).toContain("PHASE_DESCRIPTION_MARKER");
  expect(text).toContain("PLANNER_NODE_DESCRIPTION_MARKER");
  // Negative: the prompt MUST NOT contain the generic Task header.
  expect(text).not.toContain("# Task: Plan Phase 42");

  await system.dispose();
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd apps/server && bun test src/orchestration/Layers/WeaveScheduler.test.ts -t "dispatches kind === 'planning'"`

Expected: FAIL — the assertions on `text` fail because the scheduler still calls `formatNodeSpec(next)`. The first failed assertion will be `expect(text).toContain("Phase Planner")` (formatNodeSpec produces `# Task: Plan Phase 42`, which doesn't contain that substring). The negative assertion at the bottom (`not.toContain("# Task: Plan Phase 42")`) will also fail.

- [ ] **Step 3: Wire the kind-aware branch into the dispatch**

In `apps/server/src/orchestration/Layers/WeaveScheduler.ts`, edit `processSchedulerDecision`. Change the existing `thread.turn.start` dispatch (lines 293–306) so the message text is computed with a kind-aware branch.

Find this block:

```typescript
// Start the child thread's first turn with the node spec as user message
yield *
  orchestrationEngine.dispatch({
    type: "thread.turn.start",
    commandId: serverCommandId(),
    threadId: childThreadId,
    message: {
      messageId: MessageId.make(crypto.randomUUID()),
      role: "user",
      text: formatNodeSpec(next),
      attachments: [],
    },
    interactionMode: "default",
    runtimeMode: "full-access",
    createdAt: new Date().toISOString(),
  });
```

Replace it with:

```typescript
// Start the child thread's first turn with the node spec as user message.
// Planning Nodes get a structured Phase Planner prompt that constrains
// output to PhasePlannerOutput JSON; Tasks get the generic node spec.
// run.currentBlueprint is non-null here (checked at the top of this fn).
const messageText =
  next.kind === "planning"
    ? formatPlanningNodeSpec(next, run.currentBlueprint, run.run)
    : formatNodeSpec(next);

yield *
  orchestrationEngine.dispatch({
    type: "thread.turn.start",
    commandId: serverCommandId(),
    threadId: childThreadId,
    message: {
      messageId: MessageId.make(crypto.randomUUID()),
      role: "user",
      text: messageText,
      attachments: [],
    },
    interactionMode: "default",
    runtimeMode: "full-access",
    createdAt: new Date().toISOString(),
  });
```

Note: `run.currentBlueprint` was already null-checked at line 169–172 of `processSchedulerDecision` (`if (run === null || run.currentBlueprint === null) return;`), so TypeScript should narrow the type here. If TypeScript still complains because the narrowing doesn't survive across the intervening `yield*` calls and read-model lookups, store the narrowed value in a local at the top of the function:

```typescript
// (near line 168, after the early-return check)
const blueprint = run.currentBlueprint;
// Then on line 169:
// if (run === null || blueprint === null) return;
```

…and use `blueprint` rather than `run.currentBlueprint` at the new call site.

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `cd apps/server && bun test src/orchestration/Layers/WeaveScheduler.test.ts -t "dispatches kind === 'planning'"`

Expected: PASS. All assertions on `text` succeed.

Also run the full scheduler suite to confirm nothing else regressed:

Run: `cd apps/server && bun test src/orchestration/Layers/WeaveScheduler.test.ts`

Expected: all existing scheduler tests + the new planning-dispatch test + the 7 helper tests from Task 1 all pass.

- [ ] **Step 5: Commit**

```bash
cd apps/server
git add src/orchestration/Layers/WeaveScheduler.ts src/orchestration/Layers/WeaveScheduler.test.ts
git commit -m "feat(weave): scheduler sends Phase Planner prompt for kind=planning nodes"
```

---

## Task 3: Wire the helper into `WeaveNodeRestarter` retry path

**Files:**

- Modify: `apps/server/src/orchestration/Layers/WeaveNodeRestarter.ts:41–77` (the `processItem` body — lookup, log, dispatch)

**Why this matters:** When a user clicks Retry on a failed planning node, `WeaveNodeRestarter` re-dispatches the agent on the existing child thread + worktree using `formatNodeSpec(node)`. After Task 2 the initial dispatch sends a structured prompt; the retry would still send the generic Task spec, recreating the bug on every retry. Make the restarter call the same `formatPlanningNodeSpec` helper.

The change is mechanical and the helper is already unit-tested in Task 1 — no new restarter integration test is added (would require new Layer wiring; out of scope).

- [ ] **Step 1: Modify the restarter**

Edit `apps/server/src/orchestration/Layers/WeaveNodeRestarter.ts`. Update the import on line 26:

Before:

```typescript
import { formatNodeSpec } from "./WeaveScheduler.ts";
```

After:

```typescript
import { formatNodeSpec, formatPlanningNodeSpec } from "./WeaveScheduler.ts";
```

Replace the body of `processItem` (lines 39–88) so that the blueprint is captured locally (giving TypeScript a non-null narrowing) and the message text is kind-aware. The full updated function:

```typescript
const processItem = (trigger: RestartTrigger) =>
  Effect.gen(function* () {
    const run = yield* weaveEngine.getWeaveRun(trigger.weaveRunId);
    if (run === null) {
      yield* Effect.logWarning("WeaveNodeRestarter: run not found", trigger);
      return;
    }
    const blueprint = run.currentBlueprint;
    const child = run.childThreads.get(trigger.nodeId);
    const node = blueprint?.nodes.find((n) => n.id === trigger.nodeId) ?? null;
    if (!child || node === null || blueprint === null) {
      yield* Effect.logWarning("WeaveNodeRestarter: child thread, node, or blueprint not found", {
        ...trigger,
        hasChild: child !== undefined,
        hasNode: node !== null,
        hasBlueprint: blueprint !== null,
      });
      return;
    }

    yield* Effect.log("WeaveNodeRestarter: re-dispatching agent", {
      weaveRunId: trigger.weaveRunId,
      nodeId: trigger.nodeId,
      childThreadId: child.threadId,
      worktreePath: child.worktreePath,
      nodeKind: node.kind,
    });

    // Planning Nodes get the same structured Phase Planner prompt the
    // scheduler uses on initial dispatch; Tasks keep the generic node spec.
    const messageText =
      node.kind === "planning"
        ? formatPlanningNodeSpec(node, blueprint, run.run)
        : formatNodeSpec(node);

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: serverCommandId(),
      threadId: child.threadId,
      message: {
        messageId: MessageId.make(crypto.randomUUID()),
        role: "user",
        text: messageText,
        attachments: [],
      },
      interactionMode: "default",
      runtimeMode: "full-access",
      createdAt: new Date().toISOString(),
    });
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logError("WeaveNodeRestarter: unexpected error processing trigger", {
        trigger,
        cause: Cause.pretty(cause),
      });
    }),
  );
```

Update the JSDoc at the top of the file (lines 1–14) so the comment on line 9 reflects the new behavior. Replace lines 7–10:

Before:

```typescript
 *  3. Dispatches a new `thread.turn.start` on the existing child thread, with
 *     the same `formatNodeSpec(node)` text the WeaveScheduler uses on initial
 *     dispatch. The worktree is reused; no new git operations.
```

After:

```typescript
 *  3. Dispatches a new `thread.turn.start` on the existing child thread, with
 *     the same prompt the WeaveScheduler uses on initial dispatch:
 *     `formatPlanningNodeSpec` for `kind: "planning"` nodes,
 *     `formatNodeSpec` for everything else. The worktree is reused; no new
 *     git operations.
```

- [ ] **Step 2: Typecheck and run tests**

Run: `cd apps/server && bun typecheck`

Expected: PASS. TypeScript should narrow `blueprint` to non-null on the planning branch because we explicitly check `blueprint === null` in the early return.

Run: `cd apps/server && bun run test`

Expected: all existing tests pass (including the new ones from Tasks 1 and 2). The restarter has no test file, so this task adds zero new tests but doesn't break existing ones.

- [ ] **Step 3: Commit**

```bash
cd apps/server
git add src/orchestration/Layers/WeaveNodeRestarter.ts
git commit -m "feat(weave): restarter sends Phase Planner prompt on retry of kind=planning nodes"
```

---

## Task 4: Verification — full repo check + manual smoke

**Files:**

- No code changes. Run the full verification suite and a manual smoke test.

- [ ] **Step 1: Run typecheck across the whole repo**

Run: `bun typecheck` (from the repo root)

Expected: PASS. No new errors compared to the baseline of the `nikrabaev/weave` branch before this plan.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test` (from the repo root)

Expected: PASS for all new tests; all previously-passing tests still pass; no test that was passing before this plan now fails. (The `weaveIntegration.test.ts` test is already enabled and stubs the Phase Planner output by injecting an assistant JSON message — it does not exercise the live prompt path and should still pass.)

- [ ] **Step 3: Run the linter**

Run: `bun lint`

Expected: PASS. No new warnings or errors introduced.

- [ ] **Step 4: Run the formatter**

Run: `bun fmt`

Expected: no changes, or only whitespace normalizations in the three files this plan edited. If `bun fmt` modifies any file, stage and commit those formatting changes:

```bash
git add -u
git commit -m "style(weave): apply bun fmt to phase planner live dispatch"
```

- [ ] **Step 5: Manual smoke test (optional but recommended)**

Reproduce the original bug to confirm the fix is end-to-end correct:

1. Start the server in the working tree.
2. Create a weave run via the web UI with a vision like "Build a minimal todo app".
3. Approve the meta-plan when it appears.
4. Watch Phase 1's planning node dispatch.
5. Verify the agent's response is JSON (visible in the child-thread message log) and that the node transitions to `verified` rather than `failed`.

Expected outcome: Phase 1's planning node verifies; Phase 1's Tasks become visible in the UI; the next gate fires for the user to approve Phase 1's emitted plan.

If the smoke test reveals the agent still responds in markdown despite receiving the structured prompt, that indicates the agent (Codex) is ignoring the "JSON only" instruction — a separate prompt-engineering issue, not a wiring bug. In that case the fix is to harden `buildPhasePlannerPrompt` (out of scope for this plan; would be a follow-up).

- [ ] **Step 6: Push when ready**

The user will decide when to push. Do not push automatically.

---

## Self-review notes

- **Spec coverage:** The design's `## Component changes` table calls for "WeaveDispatcher: Capture structured JSON output from Planning Node child threads; route it into the extend-Blueprint flow." Slice 3 covered the capture + decode + dispatch via the conformer. This plan covers what was implicit in the design but missing from every slice's plan: the _outbound_ prompt that makes the agent _produce_ structured JSON in the first place. The "uniform dispatch protocol" the design called for is preserved — same scheduler, same worktree, same child thread mechanics. Only the user message text changes for `kind === "planning"`.
- **Placeholder scan:** All steps contain concrete code or concrete commands. No "TBD", no "implement later", no vague "add validation". The Task 1 throw-on-missing-phase test contains a small note about how to construct an inconsistent blueprint if Schema rejects the round-trip; that is concrete guidance, not a placeholder.
- **Type consistency:** `formatPlanningNodeSpec(node, blueprint, run)` has the same signature in Task 1 (definition), Task 2 (scheduler caller), and Task 3 (restarter caller). The third arg is `{ vision: string; snapshotContent?: string | undefined }` — `WeaveRun` satisfies this structurally. No type drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-weave-phase-planner-live-dispatch.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
