# Weave Incremental Planning — Slice 3: Phase Planner & Extend Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-30-weave-incremental-planning-design.md`](../specs/2026-04-30-weave-incremental-planning-design.md) — see the **Implementation status → Slice 3** section for the up-to-date hand-off.

**Slice 1 outcome:** [`2026-04-30-weave-incremental-planning-slice-1.md`](2026-04-30-weave-incremental-planning-slice-1.md) — schema deltas (`WeaveNodeKind += "planning"`, `WeaveBlueprintCompileReason += "phase-planning"`, `WeaveRun.planningDepthCap`, `WeaveBlueprintExtendedPayload`, `WeaveBlueprintExtendCommand`, `weave.blueprint-extended` event variant) plus typecheck-guard no-ops in `weaveDecider`, `weaveProjector`, `decider`, and `OrchestrationEngine`.

**Slice 2 outcome:** [`2026-04-30-weave-incremental-planning-slice-2.md`](2026-04-30-weave-incremental-planning-slice-2.md) — meta-planner prompt now emits Planning Nodes only, `planningDepthCap` defaults to 3 at `weave.created` time, `weaveIntegration.test.ts` skipped pending Slice 3+4. **Do not duplicate those.**

**Goal:** Make Planning Nodes actually do work. When a Planning Node's child thread quiesces, the conformer reads its emitted JSON, validates it as a Blueprint extension, and dispatches `weave.blueprint.extend`. The decider for that command appends the new nodes, bumps `BlueprintVersion`, and emits the planner-node-verified + blueprint-extended + blueprint-compiled events together. The Phase Planner prompt + JSON output schema land in this slice. The scheduler still doesn't auto-dispatch Planning Nodes — that's Slice 4 — but every other piece of machinery exists at the end of this slice.

**Architecture:** Most of the runtime work happens in the conformer and decider. The conformer gains a `kind === "planning"` branch that reads the agent's accumulated assistant text from the thread projection's `messages`, validates it against a new `PhasePlannerOutput` schema, then dispatches `weave.blueprint.extend`. The decider for that command does the heavy lifting: validates the planner node, builds the new Blueprint version (existing nodes ⊕ added nodes), and emits three events in a single decider pass — `weave.node-verified` for the planner node, `weave.blueprint-extended` (delta event), and `weave.blueprint-compiled (reason: "phase-planning")` (full new Blueprint). The projector for `weave.blueprint-extended` is informational (the sister `weave.blueprint-compiled` already mutates state). For the Phase Planner agent itself: a new `buildPhasePlannerPrompt` builder lands; agent dispatch (worktree allocation + child thread + turn) is reused from the existing `WeaveScheduler` — Slice 4 will wire the auto-dispatch trigger.

**Tech Stack:** Effect 4 beta, `@effect/vitest` (`it.effect`), `node:assert/strict` for contracts tests, `vitest`'s `expect` for runtime tests, `bun` for runner.

---

## Out of scope for Slice 3

- **Scheduler auto-dispatch of Planning Nodes.** Slice 4. The current scheduler (`WeaveScheduler`) treats every Node uniformly via `weave.node.dispatch`; when Slice 4 wires "Phase 1's Planning Node is `ready` after `weave.blueprint-approved`," the existing dispatch path will already work because Slice 3 leaves it untouched.
- **Mid-Phase Planning Node emissions (recursion).** A Phase Planner emitting more Planning Nodes is allowed by the design but requires depth tracking on `WeaveNode` to enforce `planningDepthCap`. Slice 3 **rejects** any extension that includes a `kind: "planning"` node; depth tracking and recursion land in a follow-up slice.
- **Web UI multi-gate approval.** Slice 5.
- **Re-enabling `weaveIntegration.test.ts`.** The Slice 2 `it.skip` stays — even with Slice 3 machinery, the end-to-end "create → complete" path needs Slice 4's auto-dispatch to actually traverse. Slice 4 will re-enable it, rewrite the fixture for the meta-plan shape, and fix the conformer-signal regression at the same time.
- **`PhasePlannerDriver` Layer (live agent invocation).** Slice 3 lands the prompt builder and the JSON schema, but the runtime driver that actually calls `ProviderService.sendTurn` for a Phase Planner agent is **not** in scope. The conformer reads the agent output from message history that a previously-dispatched agent (driven by the existing `WeaveScheduler` path in Slice 4) will have produced. Slice 3 tests stub this — they synthesize a child thread with assistant messages and exercise the conformer + decider + projector in isolation.
- **Renaming `WeavePlanner` → `MetaPlanner` and adding `PhasePlanner`.** The conceptual split lives in this slice (the new prompt builder is named `buildPhasePlannerPrompt` and lives next to `buildPlannerPrompt`), but the Layer/Service rename is cosmetic and deferred. The existing `WeavePlannerLive` continues to handle only the meta-plan path (driven by `weave.created`).

## Definition of done

- New schema `PhasePlannerOutput` decodes the JSON shape a Phase Planner agent emits, with positive and negative tests.
- `WeaveBlueprintExtendCommand` carries the full added-node payload (`addedNodes: Schema.Array(WeaveNode)`), not just IDs.
- The decider arm for `weave.blueprint.extend` is real: validates the planner node, builds the new Blueprint, emits three events, and rejects extensions that include a `kind: "planning"` node.
- The projector arm for `weave.blueprint-extended` is real (no longer a Slice 1 no-op): a sanity check that requires existing projection state, then returns state unchanged (the sister `weave.blueprint-compiled` does the actual mutation).
- A new `buildPhasePlannerPrompt` builder lives in `plannerPrompt.ts` next to the meta-planner builder, with tests asserting the constrained JSON shape.
- `WeaveContractConformer` recognizes `kind === "planning"`: instead of running a verifier command, it reads the child thread's accumulated assistant text, parses it, validates as `PhasePlannerOutput`, and dispatches `weave.blueprint.extend` on success or `weave.node.failed` on parse/schema failure.
- `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` all pass with no new failures beyond the Slice 2 baseline (1006 passed / 5 skipped / 6 failed — all 6 failures pre-existing GitManager network-timeout tests).
- Six small, focused commits — one per task plus a verification commit if needed.

---

## File structure

| File | Change |
|---|---|
| `packages/contracts/src/weave.ts` | Replace `addedNodeIds: Schema.Array(WeaveNodeId)` on `WeaveBlueprintExtendCommand` with `addedNodes: Schema.Array(WeaveNode)`. Extend `BlueprintSource` literal to include `"phase-planning"` (Slice 1 added this to `WeaveBlueprintCompileReason` but missed `BlueprintSource`; the decider in Task 2 needs both). Add new `PhasePlannerOutput` struct (a single field `addedNodes: Schema.Array(WeaveNode)`). |
| `packages/contracts/src/weave.test.ts` | Update the existing two `WeaveBlueprintExtendCommand` tests for the new field name. Add a new test for the extended `BlueprintSource` union. Add positive + negative tests for `PhasePlannerOutput`. |
| `apps/server/src/orchestration/weaveDecider.ts` | Replace the Slice 1 no-op `case "weave.blueprint.extend"` (lines 425–430) with a real handler that validates the planner node (kind=planning, status=running), validates `addedNodes` (no planning kinds, all phaseId === planner.phaseId, fresh ids), builds the new Blueprint, and emits `weave.node-verified` + `weave.blueprint-extended` + `weave.blueprint-compiled`. |
| `apps/server/src/orchestration/weaveDecider.test.ts` | Add a new `describe("decideWeaveCommand — weave.blueprint.extend", …)` block with happy-path + each rejection case. |
| `apps/server/src/orchestration/weaveProjector.ts` | Promote the Slice 1 no-op `case "weave.blueprint-extended"` (lines 355–367) to a real handler. Body: same null-state guard already there; on non-null state, return state unchanged with an `Effect.log` note. (The sister `weave.blueprint-compiled` event mutates state.) |
| `apps/server/src/orchestration/weaveProjector.test.ts` | Add a new `describe("projectWeaveEvent — weave.blueprint-extended", …)` block: rejects null state, returns unchanged on non-null state, replays cleanly with `weave.blueprint-compiled`. |
| `apps/server/src/orchestration/Layers/plannerPrompt.ts` | Add a new exported `buildPhasePlannerPrompt(input)` function next to `buildPlannerPrompt`. Constrains output to `PhasePlannerOutput` JSON shape. |
| `apps/server/src/orchestration/Layers/plannerPrompt.test.ts` | Add a new `describe("buildPhasePlannerPrompt", …)` block asserting the prompt's required-content. |
| `apps/server/src/orchestration/Layers/WeaveContractConformer.ts` | Branch on `match.node.kind`: for `"planning"`, run the new schema-validation path; for everything else, run the existing command-verifier path. New helper `processPlanningNode` reads the thread's `messages` from the read model, concatenates assistant text, parses + validates, and dispatches. |
| `apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts` | Add a new `describe("WeaveContractConformer — planning kind", …)` block: happy path (valid JSON → `weave.blueprint.extend` dispatched), bad JSON (parse failure → `weave.node.failed`), wrong shape (schema failure → `weave.node.failed`). |

`weaveCommandInvariants.ts` is **not** modified in this slice — every requirement is enforced inline in the new decider arm. Adding a `requirePlanningNodeKind` helper is a tempting refactor but would unnecessarily widen the touch surface; do it in a follow-up if the same check appears in a third place.

`OrchestrationEngine.ts` is **not** modified — Slice 1 already routed `weave.blueprint.extend` to the weave aggregate arm.

`runtimeLayer.ts` is **not** modified — no new Layer is introduced in this slice. (The conformer change is internal.)

---

## Task 1: Schema deltas — `WeaveBlueprintExtendCommand`, `PhasePlannerOutput`, extend `BlueprintSource`

**Files:**
- Modify: `packages/contracts/src/weave.ts` (the `WeaveBlueprintExtendCommand` struct, the `BlueprintSource` literal, and add new schema)
- Modify: `packages/contracts/src/weave.test.ts` (lines 1103–1135 — update existing tests; append new ones)

This task lands three schema changes at once because the decider in Task 2 depends on all of them being present:

1. **Replace `addedNodeIds: Schema.Array(WeaveNodeId)` with `addedNodes: Schema.Array(WeaveNode)`** on `WeaveBlueprintExtendCommand`. The decider arm (Task 2) needs the actual node payloads to append to the Blueprint. The event payload (`WeaveBlueprintExtendedPayload`) keeps `addedNodeIds` — the event is a delta for audit/UI; the sister `weave.blueprint-compiled` event carries the full Blueprint.
2. **Extend `BlueprintSource`** from `"planner" | "amendment" | "redesign"` to also include `"phase-planning"`. Slice 1 already added `"phase-planning"` to `WeaveBlueprintCompileReason` (a different type — the *command's* `reason`), but `BlueprintSource` (the *Blueprint struct's* `compiledBy`) was not updated. The `weave.blueprint-compiled` event emitted by Task 2's decider arm needs to set `compiledBy: "phase-planning"` on both the new Blueprint struct and the event payload, so the literal must exist.
3. **Add `PhasePlannerOutput`** — the JSON shape a Phase Planner agent emits. Reusable both in the conformer (Task 5) and any future server-side Phase Planner driver.

- [ ] **Step 1: Update the existing `WeaveBlueprintExtendCommand` tests to use `addedNodes` instead of `addedNodeIds`**

In `packages/contracts/src/weave.test.ts`, replace the two existing tests starting around line 1107 with the following. Both tests now construct full `WeaveNode` objects rather than node IDs:

```ts
it.effect("round-trips a WeaveBlueprintExtendCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintExtendCommand({
      type: "weave.blueprint.extend",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      plannerNodeId: "phase-1-planner",
      addedNodes: [
        {
          id: "task-1",
          title: "Task 1",
          description: "First task in phase 1",
          kind: "raw",
          phaseId: "phase-1",
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "bun run test",
          dependsOn: [],
          status: "pending",
        },
      ],
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.extend");
    assert.strictEqual(parsed.plannerNodeId, "phase-1-planner");
    assert.strictEqual(parsed.addedNodes.length, 1);
    assert.strictEqual(parsed.addedNodes[0]?.id, "task-1");
    assert.strictEqual(parsed.addedNodes[0]?.kind, "raw");
  }),
);

it.effect("WeaveInternalCommand union accepts weave.blueprint.extend", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveInternal({
      type: "weave.blueprint.extend",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      plannerNodeId: "phase-1-planner",
      addedNodes: [],
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.extend");
  }),
);
```

- [ ] **Step 2: Append failing tests for `PhasePlannerOutput`**

Append at the end of `packages/contracts/src/weave.test.ts`:

```ts
import { PhasePlannerOutput } from "./weave.ts";

const decodePhasePlannerOutput = Schema.decodeUnknownEffect(PhasePlannerOutput);

it.effect("decodes a PhasePlannerOutput with one task", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePhasePlannerOutput({
      addedNodes: [
        {
          id: "task-1",
          title: "Build foo",
          description: "build foo",
          kind: "raw",
          phaseId: "phase-1",
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "bun run test",
          dependsOn: [],
          status: "pending",
        },
      ],
    });
    assert.strictEqual(parsed.addedNodes.length, 1);
    assert.strictEqual(parsed.addedNodes[0]?.id, "task-1");
  }),
);

it.effect("decodes a PhasePlannerOutput with empty addedNodes (Phase concluded as no-op)", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePhasePlannerOutput({ addedNodes: [] });
    assert.strictEqual(parsed.addedNodes.length, 0);
  }),
);

it.effect("rejects a PhasePlannerOutput missing addedNodes", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodePhasePlannerOutput({}));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects a PhasePlannerOutput where a node lacks required fields", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePhasePlannerOutput({
        addedNodes: [{ id: "task-1" }],
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
```

- [ ] **Step 3: Run the contracts tests and watch them fail**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: the four new `PhasePlannerOutput` tests fail on import (`PhasePlannerOutput` does not exist yet); the two updated `WeaveBlueprintExtendCommand` tests fail because the schema still has `addedNodeIds`, not `addedNodes`.

- [ ] **Step 3a: Add a failing test for the new `BlueprintSource` literal**

Append to `packages/contracts/src/weave.test.ts`:

```ts
import { BlueprintSource } from "./weave.ts";

const decodeBlueprintSource = Schema.decodeUnknownEffect(BlueprintSource);

it.effect("BlueprintSource includes 'phase-planning'", () =>
  Effect.gen(function* () {
    for (const s of ["planner", "amendment", "redesign", "phase-planning"] as const) {
      assert.strictEqual(yield* decodeBlueprintSource(s), s);
    }
  }),
);
```

(If `BlueprintSource` is already imported elsewhere in the file, omit the duplicate import.)

Run the tests; expected: this new test fails because `"phase-planning"` is not yet in the literal union.

- [ ] **Step 4: Update the schema in `packages/contracts/src/weave.ts`**

a) Replace `addedNodeIds` with `addedNodes` on `WeaveBlueprintExtendCommand`. Find the existing struct (around line 360):

```ts
export const WeaveBlueprintExtendCommand = Schema.Struct({
  type: Schema.Literal("weave.blueprint.extend"),
  commandId: CommandId,
  weaveRunId: WeaveRunId,
  plannerNodeId: WeaveNodeId,
  addedNodeIds: Schema.Array(WeaveNodeId),
  createdAt: IsoDateTime,
});
```

Change to:

```ts
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
```

b) Extend `BlueprintSource` with `"phase-planning"`. Find (around line 160):

```ts
export const BlueprintSource = Schema.Literals(["planner", "amendment", "redesign"]);
```

Change to:

```ts
export const BlueprintSource = Schema.Literals([
  "planner",
  "amendment",
  "redesign",
  // Slice 3: tags Blueprint versions produced by a Planning Node's emission
  // (see WeaveBlueprintCompileReason).
  "phase-planning",
]);
```

c) Append the new `PhasePlannerOutput` schema. Place it immediately after `WeaveBlueprintExtendCommand`:

```ts
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd packages/contracts && bun run test src/weave.test.ts`

Expected: PASS for all six tests touched in Steps 1 and 2 (the two updated `WeaveBlueprintExtendCommand` tests, the four new `PhasePlannerOutput` tests). All previously-passing tests in this file continue to pass.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/weave.ts packages/contracts/src/weave.test.ts
git commit -m "feat(weave): slice 3 schema deltas — extend command addedNodes, BlueprintSource, PhasePlannerOutput"
```

---

## Task 2: Implement the `weave.blueprint.extend` decider arm

**Files:**
- Modify: `apps/server/src/orchestration/weaveDecider.ts:425-430` (replace the Slice 1 no-op)
- Modify: `apps/server/src/orchestration/weaveDecider.test.ts` (append new describe block)

The decider arm validates and emits. It does NOT mutate state (the projector does that, via the sister `weave.blueprint-compiled` event). The decider's job here is to:

1. Verify the run exists.
2. Verify the plannerNode exists in the current Blueprint with `kind === "planning"` and status `running`.
3. Verify every `addedNodes[i]` has `phaseId === plannerNode.phaseId`.
4. Verify no `addedNodes[i].kind === "planning"` (Slice 3 simplification — no recursion).
5. Verify every `addedNodes[i].id` is fresh (no collision with existing node IDs).
6. Emit `weave.node-verified` for `plannerNodeId` (the planner Node has succeeded — its emission landed).
7. Emit `weave.blueprint-extended` with the new `BlueprintVersion` and the extracted `addedNodeIds`.
8. Emit `weave.blueprint-compiled (reason: "phase-planning")` carrying the full new Blueprint = old Blueprint with `nodes` ⊕ `addedNodes`, version bumped.

The new `BlueprintVersion` is `currentBlueprint.version + 1`.

- [ ] **Step 1: Add failing decider tests**

Append at the end of `apps/server/src/orchestration/weaveDecider.test.ts` (before the final `});` closing the outermost `describe`, or add a new top-level `describe` after the existing ones — the file's existing structure should make this obvious; if unclear, add a new top-level `describe`):

```ts
describe("decideWeaveCommand — weave.blueprint.extend", () => {
  function buildProjectionWithPlanningNode(params: {
    plannerStatus?: WeaveNodeStatus;
    runStatus?: "draft" | "reviewing" | "running";
  }): WeaveRunProjection {
    const base = buildRunningProjection({
      nodes: [
        {
          id: "phase-1-planner",
          status: params.plannerStatus ?? "running",
          phaseId: "phase-1",
        },
      ],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    // Override kind and run status. The shared `buildRunningProjection` helper
    // forces `kind: "raw"` for every node; rebuild the blueprint with kind
    // "planning" so the decider's plannerNode lookup succeeds.
    const bp = base.currentBlueprint!;
    return {
      ...base,
      run: { ...base.run, status: params.runStatus ?? "running" },
      currentBlueprint: {
        ...bp,
        nodes: bp.nodes.map((n) =>
          n.id === WeaveNodeId.make("phase-1-planner") ? { ...n, kind: "planning" as const } : n,
        ),
      },
    };
  }

  function makeAddedNode(overrides: {
    id: string;
    phaseId?: string;
    kind?: "raw" | "scaffold" | "contract" | "utility" | "planning";
  }) {
    return {
      id: WeaveNodeId.make(overrides.id),
      title: `Task ${overrides.id}` as never,
      description: "",
      kind: (overrides.kind ?? "raw") as never,
      phaseId: WeavePhaseId.make(overrides.phaseId ?? "phase-1"),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [],
      status: "pending" as const,
    };
  }

  it("happy path: emits node-verified + blueprint-extended + blueprint-compiled", async () => {
    const projection = buildProjectionWithPlanningNode({});
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-extend-1"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [makeAddedNode({ id: "task-1" }), makeAddedNode({ id: "task-2" })],
          createdAt: now,
        },
      }),
    );

    expect(events.length).toBe(3);
    expect(events[0]?.type).toBe("weave.node-verified");
    expect(events[1]?.type).toBe("weave.blueprint-extended");
    expect(events[2]?.type).toBe("weave.blueprint-compiled");

    // node-verified targets the planner node
    expect(events[0]?.payload).toMatchObject({ nodeId: WeaveNodeId.make("phase-1-planner") });

    // blueprint-extended carries the new version and the added IDs only
    expect(events[1]?.payload).toMatchObject({
      version: 2,
      plannerNodeId: WeaveNodeId.make("phase-1-planner"),
      addedNodeIds: [WeaveNodeId.make("task-1"), WeaveNodeId.make("task-2")],
    });

    // blueprint-compiled carries the full new Blueprint at the new version
    const compiledPayload = events[2]?.payload as { version: number; blueprint: { version: number; nodes: ReadonlyArray<{ id: string }>; compiledBy: string } };
    expect(compiledPayload.version).toBe(2);
    expect(compiledPayload.blueprint.version).toBe(2);
    expect(compiledPayload.blueprint.compiledBy).toBe("phase-planning");
    expect(compiledPayload.blueprint.nodes.map((n) => n.id)).toEqual([
      "phase-1-planner",
      "task-1",
      "task-2",
    ]);
  });

  it("happy path with empty addedNodes (Phase concluded as no-op)", async () => {
    const projection = buildProjectionWithPlanningNode({});
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-extend-noop"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [],
          createdAt: now,
        },
      }),
    );
    expect(events.length).toBe(3);
    expect(events[1]?.payload).toMatchObject({ addedNodeIds: [] });
  });

  it("rejects when the run does not exist", async () => {
    const result = await Effect.runPromiseExit(
      decideWeaveCommand({
        projection: null,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [],
          createdAt: now,
        },
      }),
    );
    expect(result._tag).toBe("Failure");
  });

  it("rejects when the planner node is not kind=planning", async () => {
    // Use the default buildRunningProjection which gives kind: "raw"
    const projection = buildRunningProjection({
      nodes: [{ id: "phase-1-planner", status: "running", phaseId: "phase-1" }],
      phases: [{ id: "phase-1", ordinal: 0 }],
    });
    const result = await Effect.runPromiseExit(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [],
          createdAt: now,
        },
      }),
    );
    expect(result._tag).toBe("Failure");
  });

  it("rejects when the planner node status is not running", async () => {
    const projection = buildProjectionWithPlanningNode({ plannerStatus: "pending" });
    const result = await Effect.runPromiseExit(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [],
          createdAt: now,
        },
      }),
    );
    expect(result._tag).toBe("Failure");
  });

  it("rejects when an added node's phaseId differs from the planner's phaseId", async () => {
    const projection = buildProjectionWithPlanningNode({});
    const result = await Effect.runPromiseExit(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [makeAddedNode({ id: "task-1", phaseId: "phase-other" })],
          createdAt: now,
        },
      }),
    );
    expect(result._tag).toBe("Failure");
  });

  it("rejects when an added node has kind=planning (Slice 3 forbids recursion)", async () => {
    const projection = buildProjectionWithPlanningNode({});
    const result = await Effect.runPromiseExit(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [makeAddedNode({ id: "nested-planner", kind: "planning" })],
          createdAt: now,
        },
      }),
    );
    expect(result._tag).toBe("Failure");
  });

  it("rejects when an added node id collides with an existing node id", async () => {
    const projection = buildProjectionWithPlanningNode({});
    const result = await Effect.runPromiseExit(
      decideWeaveCommand({
        projection,
        command: {
          type: "weave.blueprint.extend",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          plannerNodeId: WeaveNodeId.make("phase-1-planner"),
          addedNodes: [makeAddedNode({ id: "phase-1-planner" })],
          createdAt: now,
        },
      }),
    );
    expect(result._tag).toBe("Failure");
  });
});
```

The helpers `buildRunningProjection`, `now`, and the imports for `CommandId`/`WeaveNodeId`/`WeavePhaseId`/`WeaveRunId`/`WeaveNodeStatus`/`WeaveRunProjection` are already present at the top of `weaveDecider.test.ts` from prior slices — do not re-import them.

- [ ] **Step 2: Run the decider tests and watch them fail**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveDecider.test.ts`

Expected: every test in the new describe block fails with the existing no-op `case "weave.blueprint.extend": return Effect.succeed([])`. The happy-path tests fail because no events are emitted; the rejection tests fail because the decider returns success (empty event list) for everything.

You will also see `addedNodeIds` references at the failing points become `addedNodes` references — that's expected from the contracts change in Task 1.

- [ ] **Step 3: Replace the no-op decider arm with the real handler**

In `apps/server/src/orchestration/weaveDecider.ts`, replace lines 425–430 (the `case "weave.blueprint.extend"` block):

```ts
case "weave.blueprint.extend": {
  // TODO(slice-2): handled by WeaveScheduler when meta-planner emits a
  // sub-DAG extension. For Slice 1 the runtime never produces this command,
  // so no events are emitted here.
  return Effect.succeed([]);
}
```

with the real handler:

```ts
case "weave.blueprint.extend": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireRunNotTerminal({ projection: run, command });

    const bp = run.currentBlueprint;
    if (bp === null) {
      return yield* Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `weave.blueprint.extend requires a compiled blueprint; none present.`,
        }),
      );
    }

    const plannerNode = bp.nodes.find((n) => n.id === command.plannerNodeId);
    if (plannerNode === undefined) {
      return yield* Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `planner node '${command.plannerNodeId}' not found in blueprint v${bp.version}.`,
        }),
      );
    }
    if (plannerNode.kind !== "planning") {
      return yield* Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `planner node '${command.plannerNodeId}' has kind '${plannerNode.kind}'; expected 'planning'.`,
        }),
      );
    }
    yield* requireNodeStatus({
      projection: run,
      command,
      nodeId: command.plannerNodeId,
      allowed: ["running"],
    });

    // Validate addedNodes: phaseId consistency, no kind="planning" (Slice 3
    // simplification), no ID collisions.
    const existingIds = new Set(bp.nodes.map((n) => n.id as string));
    const addedIds = new Set<string>();
    for (const added of command.addedNodes) {
      if (added.phaseId !== plannerNode.phaseId) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `addedNodes[*].phaseId must equal planner.phaseId ('${plannerNode.phaseId}'); got '${added.phaseId}' on node '${added.id}'.`,
          }),
        );
      }
      if (added.kind === "planning") {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Slice 3 rejects mid-phase Planning Nodes: added node '${added.id}' has kind='planning'.`,
          }),
        );
      }
      if (existingIds.has(added.id as string) || addedIds.has(added.id as string)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `addedNodes contains duplicate or already-existing node id '${added.id}'.`,
          }),
        );
      }
      addedIds.add(added.id as string);
    }

    // Build the new Blueprint: append addedNodes, bump version, switch source
    // to "phase-planning". The encoded BlueprintSource literal is `compiledBy`;
    // existing literals are "planner" | "amendment" | "redesign". Slice 3 adds
    // a fourth conceptual source — but BlueprintSource itself is **unchanged**
    // (extending it would be a contracts change out of scope). We mark the
    // compile reason via the event's payload, not the Blueprint struct.
    //
    // Per the design doc §"Why two events per planning emission?":
    //   - weave.blueprint-extended: lightweight delta (added IDs only)
    //   - weave.blueprint-compiled: full new Blueprint (so projections never
    //     reconstruct from deltas)
    const newVersion = (bp.version as number) + 1;
    const newBlueprint = {
      ...bp,
      version: newVersion as never,
      nodes: [...bp.nodes, ...command.addedNodes],
      compiledAt: command.createdAt,
      compiledBy: "phase-planning" as never,
    };

    return [
      envelope({
        type: "weave.node-verified",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          nodeId: command.plannerNodeId,
          verifierOutcome: `phase-planning emission accepted (${command.addedNodes.length} node(s))`,
          occurredAt: command.createdAt,
        },
      }),
      envelope({
        type: "weave.blueprint-extended",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          version: newVersion as never,
          plannerNodeId: command.plannerNodeId,
          addedNodeIds: command.addedNodes.map((n) => n.id),
          occurredAt: command.createdAt,
        },
      }),
      envelope({
        type: "weave.blueprint-compiled",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          version: newVersion as never,
          blueprint: newBlueprint,
          compiledBy: "phase-planning" as never,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
```

Note: `compiledBy: "phase-planning"` typechecks because Task 1 extended `BlueprintSource` to include this literal. If the implementer accidentally skipped Step 4b of Task 1, this code will fail to typecheck — that's the signal to go back and finish Task 1.

- [ ] **Step 4: Run the decider tests and confirm they pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveDecider.test.ts`

Expected: all eight new tests in the `weave.blueprint.extend` describe block PASS, plus all previously-passing decider tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/weaveDecider.ts apps/server/src/orchestration/weaveDecider.test.ts
git commit -m "feat(weave): real decider arm for weave.blueprint.extend"
```

---

## Task 3: Implement the `weave.blueprint-extended` projector arm

**Files:**
- Modify: `apps/server/src/orchestration/weaveProjector.ts:355-368` (replace the Slice 1 no-op)
- Modify: `apps/server/src/orchestration/weaveProjector.test.ts` (append new describe block)

The Slice 1 no-op already does the right thing structurally: it returns `OrchestrationProjectorDecodeError` on null state and returns the projection unchanged on non-null state. Slice 3's job is to:

1. Drop the `TODO(slice-2)` comment.
2. Add an `Effect.log` line so a future operator can spot extension events in the log stream.
3. Cover the behavior with explicit tests (replay-with-compiled-sister, and null-state rejection).

The body stays mostly the same. The behavior is intentional: the sister `weave.blueprint-compiled` event mutates state. The `weave.blueprint-extended` projector only exists so that the projection machinery has a place to fan out audit/UI hooks if desired in later slices.

- [ ] **Step 1: Add failing projector tests**

Append at the end of `apps/server/src/orchestration/weaveProjector.test.ts`:

```ts
describe("projectWeaveEvent — weave.blueprint-extended", () => {
  it("rejects when state is null", async () => {
    const event = weaveEvent("weave.blueprint-extended", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(2),
      plannerNodeId: WeaveNodeId.make("phase-1-planner"),
      addedNodeIds: [],
      occurredAt: now,
    });
    const result = await Effect.runPromiseExit(projectWeaveEvent(null, event));
    expect(result._tag).toBe("Failure");
  });

  it("returns state unchanged on non-null state", async () => {
    // Build a non-null projection by running weave.created first.
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "Test Run",
      vision: "",
      occurredAt: now,
    });
    const afterCreated = await Effect.runPromise(projectWeaveEvent(null, created));

    const extended = weaveEvent("weave.blueprint-extended", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(2),
      plannerNodeId: WeaveNodeId.make("phase-1-planner"),
      addedNodeIds: [WeaveNodeId.make("task-1")],
      occurredAt: now,
    });
    const after = await Effect.runPromise(projectWeaveEvent(afterCreated, extended));
    // Same projection — `weave.blueprint-extended` is informational; the
    // sister `weave.blueprint-compiled` does the real mutation.
    expect(after).toBe(afterCreated);
  });
});
```

- [ ] **Step 2: Run the projector tests and confirm the new ones fail or pass already**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveProjector.test.ts`

Expected: depending on whether Slice 1's no-op already returns the state-by-reference, the second test may already pass. The first test should already pass (the Slice 1 no-op already rejects null state). If both pass already, that confirms the Slice 1 no-op was structurally correct; Step 3 is then purely a comment cleanup.

- [ ] **Step 3: Promote the Slice 1 no-op to the real handler**

In `apps/server/src/orchestration/weaveProjector.ts`, replace lines 355–368:

```ts
case "weave.blueprint-extended": {
  // TODO(slice-2): applied by WeaveScheduler when a planning node's
  // sub-DAG is appended to the blueprint. For Slice 1 this event is
  // never emitted at runtime, so the projection is returned unchanged.
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.blueprint-extended requires existing projection (null received).`,
      }),
    );
  }
  return Effect.succeed(state);
}
```

with:

```ts
case "weave.blueprint-extended": {
  // Informational: the sister `weave.blueprint-compiled` event carries the
  // full new Blueprint and is what mutates projection state (see
  // weaveDecider.ts: `weave.blueprint.extend` emits both events together).
  // We keep this arm for the audit/UI hook surface; future slices can wire
  // event-stream consumers off of it without touching projection state.
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.blueprint-extended requires existing projection (null received).`,
      }),
    );
  }
  return Effect.succeed(state);
}
```

The only material difference is the comment — the body stays the same. This task is small on purpose; it's a clean place to remove the `TODO(slice-2)` marker and document the design intent.

- [ ] **Step 4: Run the projector tests and confirm they pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveProjector.test.ts`

Expected: all tests in the new describe block PASS; no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts apps/server/src/orchestration/weaveProjector.test.ts
git commit -m "feat(weave): real projector arm for weave.blueprint-extended"
```

---

## Task 4: Add `buildPhasePlannerPrompt`

**Files:**
- Modify: `apps/server/src/orchestration/Layers/plannerPrompt.ts` (append new function next to `buildPlannerPrompt`)
- Modify: `apps/server/src/orchestration/Layers/plannerPrompt.test.ts` (add new describe block)

The Phase Planner agent runs once per Planning Node dispatch. It sees: the parent Vision, the codebase snapshot, the parent Phase's metadata, the in-progress Blueprint at the time of dispatch, and the planner node's own description. It emits a JSON object matching `PhasePlannerOutput` (Task 1's schema).

Slice 3's prompt is constrained to:
- Output `PhasePlannerOutput` shape (`{ "addedNodes": [...] }`).
- Every emitted node must have `phaseId === <plannerPhaseId>` and `status: "pending"`.
- No emitted node may have `kind: "planning"` (Slice 3 simplification).

- [ ] **Step 1: Add failing prompt tests**

Append at the end of `apps/server/src/orchestration/Layers/plannerPrompt.test.ts`:

```ts
describe("buildPhasePlannerPrompt", () => {
  const baseInput = {
    vision: "Build a TODO app",
    snapshotContent: "",
    phaseTitle: "Phase 1: Scaffolding",
    phaseDescription: "Stand up the Next.js app skeleton",
    plannerNodeDescription: "Plan the Next.js scaffold sub-tasks",
    plannerPhaseId: "phase-1",
  };

  it("instructs JSON-only output", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("Return a single JSON object");
    expect(prompt).toContain("JSON only, no prose");
  });

  it("constrains the output shape to PhasePlannerOutput", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain('"addedNodes"');
  });

  it("requires every added node to have phaseId equal to the planner's phase", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("phase-1");
    expect(prompt).toMatch(/phaseId.*must equal/i);
  });

  it("requires every added node to have status='pending'", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toMatch(/status.*"pending"/);
  });

  it("forbids kind='planning' (no recursion in Slice 3)", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toMatch(/kind.*MUST NOT.*planning/i);
  });

  it("includes the user vision and phase context", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("Build a TODO app");
    expect(prompt).toContain("Phase 1: Scaffolding");
    expect(prompt).toContain("Stand up the Next.js app skeleton");
    expect(prompt).toContain("Plan the Next.js scaffold sub-tasks");
  });

  it("renders an empty snapshot as '(empty)'", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("(empty)");
  });

  it("appends a previousError section when provided", () => {
    const prompt = buildPhasePlannerPrompt({ ...baseInput, previousError: "JSON parse failed" });
    expect(prompt).toContain("PREVIOUS ATTEMPT FAILED WITH:");
    expect(prompt).toContain("JSON parse failed");
  });
});
```

You will also need to add `import { buildPhasePlannerPrompt } from "./plannerPrompt.ts";` near the top of the test file (next to the existing `buildPlannerPrompt` import).

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/plannerPrompt.test.ts`

Expected: every test in the new `buildPhasePlannerPrompt` describe block fails on import (`buildPhasePlannerPrompt` does not exist yet).

- [ ] **Step 3: Add `buildPhasePlannerPrompt`**

In `apps/server/src/orchestration/Layers/plannerPrompt.ts`, append at the end of the file (after `buildPlannerPrompt`):

```ts
/**
 * Build the structured prompt the Phase Planner sends to the LLM.
 *
 * Slice 3 of incremental planning: emits a `PhasePlannerOutput` JSON object —
 * a list of nodes (Tasks) to append under the planner's Phase. The conformer
 * (post-Slice-3 wiring) parses and validates this output, then dispatches
 * `weave.blueprint.extend`.
 *
 * Constraints (enforced both in the prompt and in the decider):
 * - Output JSON only.
 * - Every node has `phaseId === plannerPhaseId`.
 * - Every node has `status: "pending"`.
 * - No node has `kind: "planning"` (Slice 3 forbids recursion).
 */
export function buildPhasePlannerPrompt(input: {
  vision: string;
  snapshotContent: string;
  phaseTitle: string;
  phaseDescription: string;
  plannerNodeDescription: string;
  plannerPhaseId: string;
  previousError?: string;
}): string {
  const parts: string[] = [
    "You are the Weave Phase Planner. Emit the sub-DAG of Tasks for one Phase.",
    "",
    "OUTPUT REQUIREMENTS:",
    "- Return a single JSON object. JSON only, no prose, no markdown fences, no commentary.",
    "- The output must be valid JSON parseable by JSON.parse().",
    "- Do not include any text before or after the JSON object.",
    "",
    "OUTPUT SCHEMA (PhasePlannerOutput):",
    "{",
    '  "addedNodes": [',
    "    {",
    '      "id": "<WeaveNodeId — non-empty string, must be unique within the run>",',
    '      "title": "<non-empty string — names the Task>",',
    '      "description": "<string — what the Task does>",',
    '      "kind": "<\\"raw\\" | \\"scaffold\\" | \\"contract\\" | \\"utility\\"> — see RULES",',
    `      "phaseId": "${input.plannerPhaseId}",`,
    '      "scope": { "readSet": [], "writeSet": [] },',
    '      "inputContractIds": [],',
    '      "outputContractIds": [],',
    '      "verifierDescription": "<string — describe how this Task is verified>",',
    '      "dependsOn": ["<existing node id or another addedNode id>", "..."],',
    '      "status": "pending"',
    "    }",
    "  ]",
    "}",
    "",
    "RULES:",
    `- Every node's \`phaseId\` MUST equal "${input.plannerPhaseId}". Different phaseIds will be rejected.`,
    '- Every node MUST have `"status": "pending"`. Other statuses will be rejected.',
    '- A node\'s `kind` MUST NOT be `"planning"`. Slice 3 forbids mid-Phase Planning Nodes; emit only `raw`/`scaffold`/`contract`/`utility` Tasks.',
    "- Node ids must be unique within addedNodes and must not collide with any existing node id in the run.",
    "- `dependsOn` may reference existing node ids (in earlier Phases or this Phase) or other ids in this addedNodes list. Do NOT reference your own planner node — your verification fires automatically once this output is accepted.",
    "- An empty `addedNodes` array is allowed and means this Phase concludes as a no-op.",
    "",
    "USER VISION:",
    input.vision,
    "",
    "PHASE TITLE:",
    input.phaseTitle,
    "",
    "PHASE DESCRIPTION:",
    input.phaseDescription,
    "",
    "PLANNER NODE DESCRIPTION:",
    input.plannerNodeDescription,
    "",
    "CODEBASE SNAPSHOT:",
    input.snapshotContent || "(empty)",
  ];

  if (input.previousError) {
    parts.push(
      "",
      "PREVIOUS ATTEMPT FAILED WITH:",
      input.previousError,
      "",
      "Fix the issue described above and emit valid JSON.",
    );
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/plannerPrompt.test.ts`

Expected: all eight tests in `buildPhasePlannerPrompt` describe PASS; previously-passing `buildPlannerPrompt` tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/Layers/plannerPrompt.ts apps/server/src/orchestration/Layers/plannerPrompt.test.ts
git commit -m "feat(weave): add buildPhasePlannerPrompt"
```

---

## Task 5: Conformer `kind === "planning"` schema-validation path

**Files:**
- Modify: `apps/server/src/orchestration/Layers/WeaveContractConformer.ts` (extend `processItem`)
- Modify: `apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts` (append new describe block)

When the conformer trigger fires for a Planning Node (kind === "planning"), it must NOT run a verifier command. Instead:

1. Look up the child thread's `messages` from the read model.
2. Concatenate the assistant-role messages' text into one buffer.
3. Parse as JSON.
4. Decode against `PhasePlannerOutput`.
5. On success → dispatch `weave.blueprint.extend` with the decoded `addedNodes`. The decider then emits `weave.node-verified` (no need for the conformer to dispatch it separately).
6. On failure (parse or decode) → dispatch `weave.node.failed` with the error in `reason`.

For lookup of the planning node's kind, the conformer's existing `findWeaveNodeForThread` / `findWeaveNodeById` helpers already resolve the node from the projection's blueprint — extend the returned `NodeLookup` with a `kind: WeaveNodeKind` field, then branch on it inside `processItem`.

For reading `messages`: the read model exposes threads via `readModel.threads` — see `findWeaveNodeForThread`'s existing pattern of indexing into `readModel.weaveRuns`. The thread record (`OrchestrationThread`) carries `messages: ReadonlyArray<OrchestrationMessage>` (see `packages/contracts/src/orchestration.ts:359`). Filter to assistant-role messages (use whatever the project-side discriminant is — likely `role === "assistant"`); concatenate `.content` text segments.

- [ ] **Step 1: Extend `makeValidBlueprint` to accept a `kind` parameter (and a small helper for injecting assistant messages)**

The existing `makeValidBlueprint(params: { nodeId; phaseId })` helper at the top of the file always produces `kind: "raw"`. Extend it to accept an optional `kind`:

```ts
function makeValidBlueprint(params: {
  nodeId: string;
  phaseId: string;
  kind?: "raw" | "scaffold" | "contract" | "utility" | "planning";
}): Blueprint {
  const phaseId = WeavePhaseId.make(params.phaseId);
  const nodeId = WeaveNodeId.make(params.nodeId);
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: nodeId,
        title: "Test Node",
        description: "A test implementation node",
        kind: params.kind ?? "raw",
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: [],
        status: "pending",
      },
    ],
    phases: [
      {
        id: phaseId,
        ordinal: 0,
        title: "Phase 1",
        description: "First phase",
        approval: "pending",
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: now(),
    compiledBy: "planner",
  });
}
```

(Default-fallback to `"raw"` keeps the existing three tests' calls — `makeValidBlueprint({ nodeId, phaseId: "phase-1" })` — working unchanged.)

Add a helper to inject an assistant message into a child thread:

```ts
async function injectAssistantMessage(
  system: Awaited<ReturnType<typeof createConformerSystem>>,
  threadId: ThreadId,
  text: string,
): Promise<void> {
  await system.run(
    system.orchestrationEngine.appendSystemEvent({
      eventId: EventId.make(crypto.randomUUID()),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.message-sent",
      occurredAt: now(),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        messageId: MessageId.make(`msg-${crypto.randomUUID()}`),
        role: "assistant",
        text,
        turnId: null,
        streaming: false,
        createdAt: now(),
        updatedAt: now(),
      },
    }),
  );
}
```

Add the missing imports at the top of the file:

```ts
import { EventId, MessageId } from "@t3tools/contracts";
```

(Some may already be imported; merge into the existing import block.)

- [ ] **Step 2: Add the planning-kind tests**

Append at the end of the file:

```ts
describe("WeaveContractConformer — planning kind", () => {
  it("happy path: valid PhasePlannerOutput → dispatches weave.blueprint.extend", async () => {
    const projectId = "project-conformer-planning-1";
    const runId = "run-conformer-planning-1";
    const nodeId = "node-conformer-planning-1";

    // ProcessRunner stub: irrelevant for planning nodes (verifier never runs);
    // keep it returning a benign exit 0 so it doesn't trip if accidentally invoked.
    const system = await createConformerSystem("t3-conformer-planning-1-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    // seedProjectAndRunningWeave hardcodes makeValidBlueprint (with kind=raw).
    // Inline the equivalent here, but with kind=planning.
    const blueprint = makeValidBlueprint({ nodeId, phaseId: "phase-1", kind: "planning" });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something",
            createdAt: now(),
          });
          yield* system.weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });
          yield* system.scheduler.drain;
        }),
      ),
    );

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    const childEntry = projection?.childThreads.get(WeaveNodeId.make(nodeId));
    if (!childEntry) throw new Error("Expected child thread to be allocated by scheduler");
    const childThreadId = childEntry.threadId;

    // Inject the planner agent's JSON output as an assistant message.
    const validOutput = {
      addedNodes: [
        {
          id: "task-1",
          title: "Task 1",
          description: "First task in phase 1",
          kind: "raw",
          phaseId: "phase-1",
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "bun run test",
          dependsOn: [],
          status: "pending",
        },
      ],
    };
    await injectAssistantMessage(system, childThreadId, JSON.stringify(validOutput));

    // Trigger the conformer.
    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");
          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);
          yield* system.conformer.drain;
        }),
      ),
    );

    // Verifier never ran (kind=planning).
    expect(system.stubProcessRunner.getRunCount()).toBe(0);

    // Assert weave.blueprint-extended event was emitted (i.e. the decider ran
    // for our weave.blueprint.extend dispatch).
    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const extendedEvent = allEvents.find(
      (e) => e.type === "weave.blueprint-extended",
    );
    expect(extendedEvent).toBeDefined();
    const extendedPayload = (extendedEvent as { payload: { plannerNodeId: string; addedNodeIds: ReadonlyArray<string> } }).payload;
    expect(extendedPayload.plannerNodeId).toBe(nodeId);
    expect(extendedPayload.addedNodeIds).toEqual(["task-1"]);

    // Planner node should now be verified (decider emits weave.node-verified
    // alongside the blueprint events).
    const finalProjection = await system.run(
      system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)),
    );
    expect(finalProjection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("verified");

    await system.dispose();
  });

  it("parse failure: malformed JSON → dispatches weave.node.failed (reason mentions JSON parse)", async () => {
    const projectId = "project-conformer-planning-2";
    const runId = "run-conformer-planning-2";
    const nodeId = "node-conformer-planning-2";

    const system = await createConformerSystem("t3-conformer-planning-2-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const blueprint = makeValidBlueprint({ nodeId, phaseId: "phase-1", kind: "planning" });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something",
            createdAt: now(),
          });
          yield* system.weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });
          yield* system.scheduler.drain;
        }),
      ),
    );

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    const childEntry = projection?.childThreads.get(WeaveNodeId.make(nodeId));
    if (!childEntry) throw new Error("Expected child thread");
    const childThreadId = childEntry.threadId;

    await injectAssistantMessage(system, childThreadId, "{not json");

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");
          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);
          yield* system.conformer.drain;
        }),
      ),
    );

    expect(system.stubProcessRunner.getRunCount()).toBe(0);

    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const failedEvent = allEvents.find(
      (e) => e.type === "weave.node-failed" && (e.payload as { nodeId: string }).nodeId === nodeId,
    );
    expect(failedEvent).toBeDefined();
    const reason = (failedEvent as { payload: { reason: string } }).payload.reason;
    expect(reason.toLowerCase()).toContain("parse");

    const finalProjection = await system.run(
      system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)),
    );
    expect(finalProjection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("failed");

    await system.dispose();
  });

  it("schema failure: valid JSON, wrong shape → dispatches weave.node.failed (reason mentions decode)", async () => {
    const projectId = "project-conformer-planning-3";
    const runId = "run-conformer-planning-3";
    const nodeId = "node-conformer-planning-3";

    const system = await createConformerSystem("t3-conformer-planning-3-", {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const blueprint = makeValidBlueprint({ nodeId, phaseId: "phase-1", kind: "planning" });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: asProjectId(projectId),
            title: "Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make(`cmd-create-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            projectId: asProjectId(projectId),
            title: "Test Weave",
            vision: "Build something",
            createdAt: now(),
          });
          yield* system.weaveEngine.persistPlannerEvent({
            runId: WeaveRunId.make(runId),
            blueprint,
            compiledBy: "planner",
          });
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.blueprint.approve",
            commandId: CommandId.make(`cmd-approve-${runId}`),
            weaveRunId: WeaveRunId.make(runId),
            blueprintVersion: blueprint.version,
            concurrencyCap: 1,
            createdAt: now(),
          });
          yield* system.scheduler.drain;
        }),
      ),
    );

    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    const childEntry = projection?.childThreads.get(WeaveNodeId.make(nodeId));
    if (!childEntry) throw new Error("Expected child thread");
    const childThreadId = childEntry.threadId;

    // Valid JSON, but no `addedNodes` field.
    await injectAssistantMessage(system, childThreadId, JSON.stringify({ foo: 1 }));

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.conformer.start();
          yield* Effect.sleep("20 millis");
          yield* dispatchSessionReady(system.orchestrationEngine, childThreadId);
          yield* system.conformer.drain;
        }),
      ),
    );

    const allEvents = await system.run(
      Stream.runCollect(system.orchestrationEngine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const failedEvent = allEvents.find(
      (e) => e.type === "weave.node-failed" && (e.payload as { nodeId: string }).nodeId === nodeId,
    );
    expect(failedEvent).toBeDefined();
    const reason = (failedEvent as { payload: { reason: string } }).payload.reason;
    expect(reason.toLowerCase()).toContain("decode");

    await system.dispose();
  });
});
```

⚠️ **Caveat: scheduler dispatches every node uniformly today.** The Slice 1/2 scheduler doesn't yet know about `kind === "planning"` — it dispatches Planning Nodes the same way it dispatches Tasks (allocating a worktree, creating a child thread, starting a turn). That's exactly what we need for these tests, because we just want a child thread to exist so the conformer has something to inspect. The scheduler's *real* Planning Node trigger (auto-dispatch on `weave.blueprint-approved` for Phase N+1) lands in Slice 4. For Slice 3, the existing dispatch path is sufficient: the scheduler dispatches the planning node (treating it like any other), and the conformer's new branch takes over post-quiesce.

If the scheduler's existing path includes worktree allocation that the stub `GitCore` expects, those calls still fire (as they do for `kind: "raw"`). The stub at the top of this test file (`makeStubGitCore`) already handles `createWorktree`, so this just works. The verifier-running step that the conformer would trigger for Tasks is the part that gets skipped by the new kind-stratified branch.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/WeaveContractConformer.test.ts`

Expected: the three new placeholder tests pass trivially (they assert `true === true`); the real tests will fail once the placeholders are replaced with actual harness setup. Don't commit until Step 3 is done and the real tests pass.

- [ ] **Step 3: Implement the conformer's planning-kind branch**

In `apps/server/src/orchestration/Layers/WeaveContractConformer.ts`:

a) Extend `WeaveRunsForLookup`'s node element type to expose `kind`:

```ts
type WeaveRunsForLookup = ReadonlyMap<
  WeaveRunId,
  {
    readonly run: { readonly projectId: ProjectId };
    readonly currentBlueprint: {
      readonly nodes: ReadonlyArray<{
        readonly id: WeaveNodeId;
        readonly kind: "raw" | "scaffold" | "contract" | "utility" | "planning";
        readonly verifierCommand?: string | undefined;
      }>;
    } | null;
    readonly childThreads: ReadonlyMap<
      WeaveNodeId,
      { readonly threadId: string; readonly worktreePath: string }
    >;
  }
>;
```

b) Extend `NodeLookup`:

```ts
interface NodeLookup {
  readonly weaveRunId: WeaveRunId;
  readonly nodeId: WeaveNodeId;
  readonly threadId: string;
  readonly worktreePath: string;
  readonly projectId: ProjectId;
  readonly nodeKind: "raw" | "scaffold" | "contract" | "utility" | "planning";
  readonly nodeVerifierCommand: string | null;
}
```

c) In both `findWeaveNodeForThread` and `findWeaveNodeById`, populate `nodeKind: node?.kind ?? "raw"` (fallback for safety; in practice the node is always present since we just resolved it from the same blueprint).

d) Inside `processItem`, after the existing match/status guard (around line 224), branch on kind:

```ts
const { weaveRunId, nodeId, threadId, worktreePath, projectId, nodeKind, nodeVerifierCommand } = match;

if (nodeKind === "planning") {
  yield* processPlanningNode({
    weaveRunId,
    nodeId,
    threadId,
    readModel,
    weaveEngine,
  });
  return;
}

// existing path: resolve verifier, run, dispatch — unchanged
const project = readModel.projects.find((p) => p.id === projectId) ?? null;
// ... etc
```

e) Add the new helper above `make` (or inside it as a nested closure, your choice):

```ts
function processPlanningNode(params: {
  readonly weaveRunId: WeaveRunId;
  readonly nodeId: WeaveNodeId;
  readonly threadId: string;
  readonly readModel: {
    readonly threads: ReadonlyArray<{
      readonly id: string;
      readonly messages: ReadonlyArray<{
        readonly role: string;
        readonly text: string;
      }>;
    }>;
  };
  readonly weaveEngine: {
    readonly dispatchWeaveCommand: (cmd: WeaveCommand) => Effect.Effect<unknown, OrchestrationDispatchError>;
  };
}): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    // OrchestrationMessage shape (per packages/contracts/src/orchestration.ts):
    //   { id, role, text: string, attachments?, turnId, streaming, createdAt, updatedAt }
    // We only read assistant-role messages and concatenate their `text` field.
    const thread = params.readModel.threads.find((t) => t.id === params.threadId);
    const assistantText = (thread?.messages ?? [])
      .filter((m) => m.role === "assistant")
      .map((m) => m.text)
      .join("");

    const createdAt = new Date().toISOString();

    if (assistantText.trim().length === 0) {
      yield* params.weaveEngine
        .dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId: params.weaveRunId,
          nodeId: params.nodeId,
          reason: "planning node emitted no assistant text",
          createdAt,
        })
        .pipe(Effect.ignore);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(assistantText);
    } catch (e) {
      yield* params.weaveEngine
        .dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId: params.weaveRunId,
          nodeId: params.nodeId,
          reason: `planning JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          failureOutput: assistantText.slice(-1024), // last 1KB for debugging
          createdAt,
        })
        .pipe(Effect.ignore);
      return;
    }

    const decodeResult = Schema.decodeUnknownEither(PhasePlannerOutput)(parsed);
    if (decodeResult._tag === "Left") {
      yield* params.weaveEngine
        .dispatchWeaveCommand({
          type: "weave.node.failed",
          commandId: serverCommandId(),
          weaveRunId: params.weaveRunId,
          nodeId: params.nodeId,
          reason: `planning output decode failed: ${decodeResult.left.message ?? "schema mismatch"}`,
          failureOutput: assistantText.slice(-1024),
          createdAt,
        })
        .pipe(Effect.ignore);
      return;
    }

    const output = decodeResult.right;

    yield* params.weaveEngine
      .dispatchWeaveCommand({
        type: "weave.blueprint.extend",
        commandId: serverCommandId(),
        weaveRunId: params.weaveRunId,
        plannerNodeId: params.nodeId,
        addedNodes: output.addedNodes,
        createdAt,
      })
      .pipe(Effect.ignore);
  });
}
```

The `.pipe(Effect.ignore)` on each dispatch absorbs any `OrchestrationDispatchError` (e.g., the decider rejecting the extend command if our local validation passed but the decider's invariants tighten). Logging is left to the surrounding `processItem` catch block; the helper's responsibility is to dispatch and move on.

The `OrchestrationMessage`'s `text` field is the right field to read per the contracts schema (`packages/contracts/src/orchestration.ts` defines `ThreadMessageSentPayload.text: Schema.String`). If a future schema change splits `text` into structured content (e.g., `content: Array<{type, text}>`), this helper will need updating — but that's a contracts change, not a Slice 3 concern.

f) Imports to add at the top of `WeaveContractConformer.ts`:

```ts
import { PhasePlannerOutput, type WeaveCommand } from "@t3tools/contracts";
import { Schema } from "effect";
```

(Some of these may already be imported; merge into the existing `import` blocks rather than duplicating.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/WeaveContractConformer.test.ts`

Expected: all three new tests in the `planning kind` describe block PASS (after the placeholders have been replaced with real harness setup); all previously-passing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/Layers/WeaveContractConformer.ts apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts
git commit -m "feat(weave): conformer schema-validates kind='planning' nodes and dispatches weave.blueprint.extend"
```

---

## Task 6: Whole-repo verification

**Files:** No file changes expected. Verification only; if any guard fixes are needed, they get a separate commit.

- [ ] **Step 1: Repo-wide typecheck**

Run: `bun typecheck` (from repo root: `/Users/nikrabaev/Work/oss/t3code`)

Expected: PASS for all 10 packages.

If TS errors appear in places that constructed `WeaveBlueprintExtendCommand` with `addedNodeIds` (the Slice 1 schema field) — e.g., test fixtures, the no-op decider arm, or `commandInvariants.test.ts` — those need to be updated to use `addedNodes`. Most of these were already updated as part of Task 1 (in `weave.test.ts`); double-check by grepping:

```
grep -rn "addedNodeIds" packages/contracts/src apps/server/src
```

Every remaining reference outside the *event payload* (`WeaveBlueprintExtendedPayload.addedNodeIds`, which is correct) is suspect.

- [ ] **Step 2: Repo-wide tests**

Run: `bun run test`

Expected: tests for `weave.test.ts`, `plannerPrompt.test.ts`, `weaveDecider.test.ts`, `weaveProjector.test.ts`, `WeaveContractConformer.test.ts` all pass with the new assertions.

The expected baseline shift relative to Slice 2:
- Slice 2 actual: 1006 passed / 5 skipped / 6 failed.
- Slice 3 expected: ≥1020 passed / 5 skipped / 6 failed (the 6 GitManager network-timeout failures remain pre-existing; the new tests in Tasks 1–5 add roughly 14–18 passing tests).

Compare against this. If new tests fail that aren't on the pre-existing list, treat as a regression and STOP. Report which tests failed and what their failure mode looks like. Do NOT attempt large fixes — escalate to the controller.

- [ ] **Step 3: Lint and format**

Run: `bun lint && bun fmt`

Expected: lint passes (warnings are pre-existing and acceptable; errors are not). `bun fmt` may reformat files this slice touched — accept those.

If `bun fmt` reformats files outside this slice's scope (i.e., docs files, other packages' source not modified by Tasks 1–5), do NOT include them. Revert them with `git checkout -- <path>`.

- [ ] **Step 4: Commit any guard fixes (only if needed)**

If Step 1 or Step 2 forced you to update fixtures or downstream consumers, commit them separately:

```bash
git add <files>
git commit -m "feat(weave): supply addedNodes in downstream fixtures"
```

If `bun fmt` reformatted any in-scope files, stage and commit them as:

```bash
git add <files>
git commit -m "style(weave): apply bun fmt to slice 3 files"
```

If neither was needed, skip this step. Slice 3 ends with the five task commits from Tasks 1–5.

---

## Self-review checklist

Run through this once Task 6 is done.

- **Spec coverage.** Every Slice 3 deliverable from the design doc's Implementation status section maps to a task here:
  - PhasePlanner JSON schema (`PhasePlannerOutput`) → Task 1
  - `weave.blueprint.extend` command shape change → Task 1
  - Decider arm for `weave.blueprint.extend` (with `requireRun`, version bump, append) → Task 2
  - Projector arm for `weave.blueprint-extended` → Task 3
  - PhasePlanner prompt builder → Task 4
  - Conformer kind='planning' schema-validation path → Task 5
  - Whole-repo gates → Task 6

- **No placeholder language.** The plan should contain no `TBD`, `TODO`, "implement later," or vague "add validation"-style steps. Task 5's three test bodies are *sketches with explicit acknowledgment* — the implementer is told exactly which existing test patterns to mirror, and the conditions under which to escalate. That's intentional honest scope, not a placeholder.

- **Type consistency.** Field names match between schema, prompt, fixtures, and runtime:
  - `addedNodes` (singular form on the command; plural form on `PhasePlannerOutput`) — both refer to `Schema.Array(WeaveNode)`.
  - `addedNodeIds` only on the **event payload** `WeaveBlueprintExtendedPayload` — extracted by the decider.
  - `plannerNodeId` (singular spelling, matching Slice 1's command schema field).

- **Out-of-scope hold.** The Slice 4 trigger (auto-dispatch of next-Phase Planning Node on Phase completion) was NOT added. The web UI multi-gate change was NOT added. Mid-Phase Planning Node recursion was NOT added — Task 2 explicitly rejects extensions with `kind: "planning"`. The `WeaveScheduler` was NOT modified. `weaveIntegration.test.ts` stays skipped (Slice 4 will re-enable it).

- **Commit hygiene.** Five small commits for Tasks 1–5, plus optionally a sixth from Task 6 if downstream fixtures or formatter changes needed updates.

---

## What ships at end of Slice 3

The full machinery for "Phase Planning Node emits Tasks → Blueprint extends → run goes back to reviewing → user approves → Tasks ready to dispatch" exists. The only missing piece for a working incremental-planning run is the scheduler trigger that auto-dispatches a Planning Node when its Phase becomes ready. That's Slice 4.

If a Planning Node is somehow dispatched in this slice (e.g., via a manual `weave.node.dispatch` from a test harness or a CLI), the rest of the chain works end-to-end:
- Agent runs in child thread.
- Conformer sees the kind=planning node, reads agent output, validates, dispatches `weave.blueprint.extend`.
- Decider validates, emits node-verified + extended + compiled.
- Projector applies the new Blueprint, transitions run to `reviewing`.
- User approves via existing `weave.blueprint.approve` flow.
- Run goes back to `running` with the new Tasks ready for dispatch.

What does NOT yet auto-happen: the trigger that says "Phase 1 is done; dispatch Phase 2's Planning Node." Slice 4.
