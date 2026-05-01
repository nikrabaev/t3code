# Weave Incremental Planning — Slice 4: Scheduler Integration & Projector Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-30-weave-incremental-planning-design.md`](../specs/2026-04-30-weave-incremental-planning-design.md) — see the **Implementation slices → Slice 4** entry.

**Slice 1 outcome:** [`2026-04-30-weave-incremental-planning-slice-1.md`](2026-04-30-weave-incremental-planning-slice-1.md) — schema deltas (`WeaveNodeKind += "planning"`, `WeaveBlueprintCompileReason += "phase-planning"`, `WeaveRun.planningDepthCap`, `WeaveBlueprintExtendedPayload`, `WeaveBlueprintExtendCommand`, `weave.blueprint-extended` event variant) plus typecheck-guard no-ops.

**Slice 2 outcome:** [`2026-04-30-weave-incremental-planning-slice-2.md`](2026-04-30-weave-incremental-planning-slice-2.md) — meta-planner emits Planning Nodes only, `planningDepthCap` defaults to 3 at create, `weaveIntegration.test.ts` skipped.

**Slice 3 outcome:** [`2026-04-30-weave-incremental-planning-slice-3.md`](2026-04-30-weave-incremental-planning-slice-3.md) — `WeaveBlueprintExtendCommand.addedNodes`, `BlueprintSource += "phase-planning"`, `PhasePlannerOutput` schema, real decider arm for `weave.blueprint.extend` (3-event emission), real projector arm for `weave.blueprint-extended`, `buildPhasePlannerPrompt`, `WeaveContractConformer` recognizes `kind === "planning"` and dispatches `weave.blueprint.extend`. **Do not duplicate those.** One known design gap was deferred to Slice 4: the `weave.blueprint-compiled` projector arm wipes `nodeMeta` from scratch, erasing the planner node's `verified` status set by the preceding `weave.node-verified` event in the same batch. Slice 4 fixes this and tightens the relaxed Slice 3 conformer test that worked around it.

**Goal:** Make Planning Nodes dispatch automatically at Phase boundaries and make the end-to-end "create → meta-plan → Phase 1 plan → Phase 1 execute → Phase 2 plan → Phase 2 execute → complete" path traverse cleanly under stub drivers. Two pieces: (1) projector preserves prior `nodeMeta` across compiles; (2) scheduler treats Planning Nodes specially — a Phase N Planning Node is ready iff every node in Phases < N is `verified`. The end-to-end integration test (skipped since Slice 2) is rewritten and re-enabled.

**Architecture:** All work lives server-side. The projector change is a 4-line semantic shift inside the existing `weave.blueprint-compiled` arm. The scheduler change is a kind-aware refinement of `computeReadySet` — Planning Nodes use Phase-ordinal predecessor verification, Tasks keep the existing `dependsOn` check. The integration test is rewritten to drive the meta-plan flow with a stub `PlannerDriver` (returns the meta-Blueprint) and a "smart driver" that, when a child thread starts a turn, either injects a Phase-Planner JSON output (for Planning Nodes) or just dispatches `thread.session.set { status: "ready" }` (for Tasks — the conformer's verifier path runs).

**Tech Stack:** Effect 4 beta, `@effect/vitest` (`it.effect`), `node:assert/strict` for contracts tests, `vitest`'s `expect` for runtime tests, `bun` for runner.

---

## Out of scope for Slice 4

- **Mid-Phase Planning Node recursion.** The decider's "rejects `kind: "planning"` in `addedNodes`" guard from Slice 3 stays. The depth-tracking machinery (`WeaveNode.depth` or equivalent) and recursive emissions land in a later slice.
- **Re-plan Phase / Edit Vision UX.** Slice 5 (web) and beyond.
- **Web UI multi-gate approval.** Slice 5.
- **Live `PhasePlannerDriver` Layer.** No runtime invocation of an LLM for Phase Planning. The integration test injects the agent's JSON output as an assistant message; production wiring of the driver is a follow-up slice.
- **Renaming `WeavePlanner → MetaPlanner` and adding a separate `PhasePlanner` service.** Cosmetic; deferred.
- **Parallel scheduling.** The existing concurrency cap is already 1 in tests. Slice 4 doesn't change concurrency.
- **The `WeaveNodeRestarter` reactor's interaction with Planning Nodes.** Out of scope; Slice 4 doesn't dispatch retries on Planning Nodes.

## Definition of done

- The `weave.blueprint-compiled` projector arm preserves prior `nodeMeta` for nodes that survive into the new Blueprint. New nodes still seed `{ status: "pending" }`. Existing tests pass; new tests cover the preservation behavior.
- The Slice 3 conformer happy-path test (around `WeaveContractConformer.test.ts:625`) is tightened: the relaxed `weave.node-verified` event-existence assertion is replaced with the original `nodeMeta.get(plannerNodeId)?.status === "verified"` projection-state assertion. The relaxation comment is removed.
- The scheduler's `computeReadySet` is kind-aware: Planning Nodes are ready iff every node whose `phaseOrdinal < plannerPhaseOrdinal` is `verified`; Tasks keep the existing `dependsOn`-based check. New tests cover the kind-stratified behavior; existing tests stay green.
- `weaveIntegration.test.ts` is re-enabled (no `it.skip`). It drives a 2-Phase meta-plan flow end-to-end with a stub `PlannerDriver` + a stub `ProcessRunner` + a stub `GitCore` + a smart turn-start driver that injects Phase-Planner JSON for `kind: "planning"` child threads. The test asserts run reaches `complete` after both Phases' Tasks verify.
- `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` all pass with no new failures beyond the Slice 3 baseline (1026 passed / 5 skipped / 7 failed — all 7 GitManager network-timeout failures pre-existing). Slice 4 is expected to add ~10 new passing tests AND un-skip 1 existing one (so post-slice baseline is roughly: 1037 passed / 4 skipped / 7 failed).
- Four small, focused commits — one per task plus a verification commit if needed.

---

## File structure

| File                                                                  | Change                                                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration/weaveProjector.ts`                     | Modify the `case "weave.blueprint-compiled"` arm (lines 117–144) to preserve existing `nodeMeta` entries. The body grows by 2 lines and a comment.                      |
| `apps/server/src/orchestration/weaveProjector.test.ts`                | Append a new `describe("projectWeaveEvent — weave.blueprint-compiled (nodeMeta preservation)", …)` block.                                                               |
| `apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts` | Tighten the Slice 3 happy-path planning-kind test (around line 625): replace event-existence assertion with `nodeMeta` status assertion; remove the relaxation comment. |
| `apps/server/src/orchestration/Layers/WeaveScheduler.ts`              | Modify `computeReadySet` (lines 50–56) to be kind-aware.                                                                                                                |
| `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts`         | Append a new `describe("WeaveScheduler — kind-stratified ready check", …)` block with four tests.                                                                       |
| `apps/server/src/orchestration/weaveIntegration.test.ts`              | Rewrite the test body in place (the skipped `it.skip` block becomes a real `it` block). Add stub-driver helpers for the meta-plan flow.                                 |

`weaveDecider.ts` is **not** modified — Slice 3's decider arm for `weave.blueprint.extend` is correct.

`WeaveContractConformer.ts` (the source) is **not** modified — Slice 3's planning-kind branch is correct.

`plannerPrompt.ts` is **not** modified — Slice 3's `buildPhasePlannerPrompt` is correct.

`WeaveScheduler.ts`'s `pickNext` is **not** modified — phase-ordinal-asc + node-id tiebreak is still the right sort order. Only `computeReadySet` changes.

Contracts (`packages/contracts/src/weave.ts`) are **not** modified.

---

## Task 1: Projector preserves `nodeMeta` on `weave.blueprint-compiled`

**Files:**

- Modify: `apps/server/src/orchestration/weaveProjector.ts:117-144` (the `weave.blueprint-compiled` arm)
- Modify: `apps/server/src/orchestration/weaveProjector.test.ts` (append a new describe block)
- Modify: `apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts` (tighten the Slice 3 relaxation around line 625)

**Why this matters:** Slice 3's decider for `weave.blueprint.extend` emits three events in order: `weave.node-verified` (planner) → `weave.blueprint-extended` (informational) → `weave.blueprint-compiled` (full new Blueprint). The first event sets the planner node's status to `verified` in `nodeMeta`. The third event currently rebuilds `nodeMeta` from scratch via `for (const node of payload.blueprint.nodes) { nextNodeMeta.set(node.id, { status: "pending" }) }`, wiping the just-set verified status. The fix preserves prior status entries and only seeds `pending` for nodes that didn't exist before.

This is universally correct: for the meta-planner's `initial` compile, `state.nodeMeta` is empty (the run was in `draft`), so all nodes still seed `pending`. For `amendment` and `redesign` reasons, surviving nodes keep their state — which is the conceptually correct behavior anyway. For `phase-planning`, the planner node keeps `verified`.

- [ ] **Step 1: Add failing tests for `nodeMeta` preservation**

Append at the end of `apps/server/src/orchestration/weaveProjector.test.ts` (in a new top-level `describe` after the existing `weave.blueprint-extended` block):

```ts
describe("projectWeaveEvent — weave.blueprint-compiled (nodeMeta preservation)", () => {
  it("preserves prior verified status when a node survives into a new Blueprint version", async () => {
    // Build a starting projection with a node already verified.
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      projectId: ProjectId.make("project-1"),
      title: "Test",
      vision: "",
      occurredAt: now,
    });
    const v1 = Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: WeaveNodeId.make("n1"),
          title: "N1",
          description: "",
          kind: "planning",
          phaseId: WeavePhaseId.make("p1"),
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
          id: WeavePhaseId.make("p1"),
          ordinal: 0,
          title: "P1",
          description: "",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now,
      compiledBy: "planner",
    });
    const compileV1 = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      version: BlueprintVersion.make(1),
      blueprint: v1,
      compiledBy: "planner",
      occurredAt: now,
    });
    const verified = weaveEvent("weave.node-verified", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      nodeId: WeaveNodeId.make("n1"),
      verifierOutcome: "ok",
      occurredAt: now,
    });

    // Apply created → blueprint-compiled v1 → node-verified for n1.
    const afterCreated = await Effect.runPromise(projectWeaveEvent(null, created));
    const afterV1 = await Effect.runPromise(projectWeaveEvent(afterCreated, compileV1));
    const afterVerified = await Effect.runPromise(projectWeaveEvent(afterV1, verified));
    expect(afterVerified.nodeMeta.get(WeaveNodeId.make("n1"))?.status).toBe("verified");

    // Now apply blueprint-compiled v2 with phase-planning reason (n1 still
    // present, plus a fresh task n2 added).
    const v2 = Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(2),
      nodes: [
        ...v1.nodes,
        {
          id: WeaveNodeId.make("n2"),
          title: "N2",
          description: "",
          kind: "raw",
          phaseId: WeavePhaseId.make("p1"),
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [WeaveNodeId.make("n1")],
          status: "pending",
        },
      ],
      phases: v1.phases,
      contracts: [],
      decisions: [],
      compiledAt: now,
      compiledBy: "phase-planning",
    });
    const compileV2 = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-preserve-1"),
      version: BlueprintVersion.make(2),
      blueprint: v2,
      compiledBy: "phase-planning",
      occurredAt: now,
    });

    const afterV2 = await Effect.runPromise(projectWeaveEvent(afterVerified, compileV2));

    // n1's verified status survives; n2 starts at pending.
    expect(afterV2.nodeMeta.get(WeaveNodeId.make("n1"))?.status).toBe("verified");
    expect(afterV2.nodeMeta.get(WeaveNodeId.make("n2"))?.status).toBe("pending");
  });

  it("seeds 'pending' for every node on the very first compile (state.nodeMeta empty)", async () => {
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-preserve-2"),
      projectId: ProjectId.make("project-1"),
      title: "Test",
      vision: "",
      occurredAt: now,
    });
    const v1 = Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: WeaveNodeId.make("a"),
          title: "A",
          description: "",
          kind: "raw",
          phaseId: WeavePhaseId.make("p1"),
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
        {
          id: WeaveNodeId.make("b"),
          title: "B",
          description: "",
          kind: "raw",
          phaseId: WeavePhaseId.make("p1"),
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
          id: WeavePhaseId.make("p1"),
          ordinal: 0,
          title: "P1",
          description: "",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now,
      compiledBy: "planner",
    });
    const compileV1 = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-preserve-2"),
      version: BlueprintVersion.make(1),
      blueprint: v1,
      compiledBy: "planner",
      occurredAt: now,
    });
    const afterCreated = await Effect.runPromise(projectWeaveEvent(null, created));
    const afterV1 = await Effect.runPromise(projectWeaveEvent(afterCreated, compileV1));
    expect(afterV1.nodeMeta.get(WeaveNodeId.make("a"))?.status).toBe("pending");
    expect(afterV1.nodeMeta.get(WeaveNodeId.make("b"))?.status).toBe("pending");
  });
});
```

The helpers `weaveEvent`, `WeaveRunId`, `WeaveNodeId`, `WeavePhaseId`, `BlueprintVersion`, `ProjectId`, `Blueprint`, `Schema`, `Effect`, `projectWeaveEvent`, `now`, `describe`, `it`, `expect` should already be imported at the top of `weaveProjector.test.ts` from earlier slices' tests. If `Schema` and `Blueprint` are missing, add minimal imports — match the existing import style.

- [ ] **Step 2: Run the projector tests and confirm the first test fails**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveProjector.test.ts`

Expected: the first test (`preserves prior verified status…`) FAILS — the assertion `afterV2.nodeMeta.get("n1")?.status === "verified"` returns `"pending"` because the current arm rebuilds `nodeMeta` from scratch. The second test (`seeds 'pending' for every node…`) PASSES even before the fix, since `state.nodeMeta` is empty on the initial compile.

- [ ] **Step 3: Fix the projector arm**

In `apps/server/src/orchestration/weaveProjector.ts`, replace the `weave.blueprint-compiled` arm at lines 117–144. Find:

```ts
case "weave.blueprint-compiled": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.blueprint-compiled requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  const nextNodeMeta = new Map<WeaveNodeId, WeaveNodeMeta>();
  for (const node of payload.blueprint.nodes) {
    nextNodeMeta.set(node.id, { status: "pending" });
  }
  const nextOpenDecisions = new Set<WeaveDecisionId>();
  for (const decision of payload.blueprint.decisions) {
    if (decision.resolution === undefined) {
      nextOpenDecisions.add(decision.id);
    }
  }
  return Effect.succeed({
    ...state,
    run: { ...state.run, status: "reviewing" },
    currentBlueprint: payload.blueprint,
    nodeMeta: nextNodeMeta,
    openDecisions: nextOpenDecisions,
  });
}
```

Change to:

```ts
case "weave.blueprint-compiled": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.blueprint-compiled requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  // Preserve `nodeMeta` for nodes that survive into the new Blueprint.
  // New nodes (added by amendment/redesign/phase-planning) seed at "pending".
  // This preserves the planner node's "verified" status set by the preceding
  // `weave.node-verified` event in a `weave.blueprint.extend` batch (Slice 3
  // emitted node-verified + extended + compiled together).
  const nextNodeMeta = new Map<WeaveNodeId, WeaveNodeMeta>();
  for (const node of payload.blueprint.nodes) {
    const existing = state.nodeMeta.get(node.id);
    nextNodeMeta.set(node.id, existing ?? { status: "pending" });
  }
  const nextOpenDecisions = new Set<WeaveDecisionId>();
  for (const decision of payload.blueprint.decisions) {
    if (decision.resolution === undefined) {
      nextOpenDecisions.add(decision.id);
    }
  }
  return Effect.succeed({
    ...state,
    run: { ...state.run, status: "reviewing" },
    currentBlueprint: payload.blueprint,
    nodeMeta: nextNodeMeta,
    openDecisions: nextOpenDecisions,
  });
}
```

The only material change is the `existing ?? { status: "pending" }` lookup inside the loop. Run.status still transitions to `"reviewing"` unconditionally (correct for `initial`/`amendment`/`redesign`/`phase-planning` per the design).

- [ ] **Step 4: Run the projector tests and confirm they all pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveProjector.test.ts`

Expected: both new tests PASS; all previously-passing tests stay green.

- [ ] **Step 5: Tighten the Slice 3 conformer happy-path test**

In `apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts`, find the relaxed assertion block in the happy-path planning-kind test (around lines 625–639). It currently looks like:

```ts
// The decider emits `weave.node-verified` for the planner node alongside
// the blueprint events. Assert the event itself rather than the projected
// status: the existing `weave.blueprint-compiled` projector arm rebuilds
// `nodeMeta` from scratch (resetting to "pending") and does not yet
// preserve nodeMeta for `compiledBy: "phase-planning"` compiles. That
// projector behavior is a known design gap (see plan note line 133:
// "Planning Node transitions to verified") and is out of scope for this
// task per the file-modification scope.
const verifiedEvent = allEvents.find(
  (e) =>
    e.type === "weave.node-verified" &&
    "payload" in e &&
    (e.payload as { nodeId: string }).nodeId === nodeId,
);
expect(verifiedEvent).toBeDefined();
```

Replace it with:

```ts
// Slice 4 fix: the `weave.blueprint-compiled` projector arm now preserves
// prior `nodeMeta` entries, so the planner node keeps its `verified`
// status set by the preceding `weave.node-verified` event in the same
// dispatch batch.
const finalProjection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
expect(finalProjection?.nodeMeta.get(WeaveNodeId.make(nodeId))?.status).toBe("verified");
```

- [ ] **Step 6: Run the conformer tests and confirm the tightened assertion passes**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/WeaveContractConformer.test.ts`

Expected: all 6 tests pass (the tightened happy-path test now asserts the projection state, which holds thanks to the projector fix).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts apps/server/src/orchestration/weaveProjector.test.ts apps/server/src/orchestration/Layers/WeaveContractConformer.test.ts
git commit -m "feat(weave): projector preserves nodeMeta on blueprint-compiled; tighten conformer test"
```

---

## Task 2: Scheduler kind-stratified ready check

**Files:**

- Modify: `apps/server/src/orchestration/Layers/WeaveScheduler.ts:50-56` (the `computeReadySet` function)
- Modify: `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` (append new describe block)

**Why this matters:** The meta-planner emits Phase Planning Nodes with `dependsOn: []`. Under the existing `computeReadySet`, every Planning Node would be "ready" at run start because they all have empty `dependsOn`. The design requires Phase N's Planning Node to wait until every node in Phases < N is `verified` — the user must see one Phase complete before the next Phase's plan is materialized.

The fix is local to `computeReadySet`: when a node has `kind === "planning"`, check phase-ordinal predecessors instead of `dependsOn`. Tasks (every other kind) keep the existing check. `pickNext` is already phase-ordinal-aware for the sort, so no change there.

Edge cases the new logic must handle:

- Phase 0's Planning Node: trivially ready at run start (no earlier Phases).
- Two Phases at the same ordinal: not currently a meta-planner output, but the predicate `otherOrdinal < myOrdinal` correctly excludes peers — they don't gate each other.
- A Task in Phase N whose Planning Node has emitted: standard `dependsOn` check; the planner node's `verified` status (preserved by the Task 1 projector fix) makes this work.

- [ ] **Step 1: Add failing tests for the kind-stratified ready check**

Append at the end of `apps/server/src/orchestration/Layers/WeaveScheduler.test.ts` (new top-level `describe` after the existing block; if the existing top-level `describe` is the only one and it's the natural home, append the new block inside it — match the file's structure):

```ts
describe("WeaveScheduler — kind-stratified ready check", () => {
  /**
   * Build a 2-Phase meta-blueprint: Phase 1 has one Planning Node, Phase 2
   * has one Planning Node. Both Planning Nodes have empty dependsOn (the
   * meta-planner doesn't set cross-Phase dependencies — Phase ordering
   * is enforced by the scheduler's kind-stratified check).
   */
  function makeTwoPhaseMetaBlueprint(): Blueprint {
    const phase1Id = WeavePhaseId.make("phase-1");
    const phase2Id = WeavePhaseId.make("phase-2");
    return Schema.decodeSync(Blueprint)({
      version: BlueprintVersion.make(1),
      nodes: [
        {
          id: WeaveNodeId.make("phase-1-planner"),
          title: "Phase 1 Planner",
          description: "",
          kind: "planning",
          phaseId: phase1Id,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
        {
          id: WeaveNodeId.make("phase-2-planner"),
          title: "Phase 2 Planner",
          description: "",
          kind: "planning",
          phaseId: phase2Id,
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        { id: phase1Id, ordinal: 0, title: "Phase 1", description: "", approval: "pending" },
        { id: phase2Id, ordinal: 1, title: "Phase 2", description: "", approval: "pending" },
      ],
      contracts: [],
      decisions: [],
      compiledAt: now(),
      compiledBy: "planner",
    });
  }

  it("dispatches Phase 1's Planning Node first when run starts", async () => {
    const projectId = "project-kind-1";
    const runId = "run-kind-1";
    const system = await createSchedulerSystem("t3-scheduler-kind-1-");
    await seedProject(system.orchestrationEngine, projectId);
    await seedRunningWeaveRun(system.weaveEngine, {
      runId,
      projectId,
      blueprint: makeTwoPhaseMetaBlueprint(),
    });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.scheduler.drain;
        }),
      ),
    );

    expect(system.stubGit.getCallCount()).toBe(1);
    expect(system.stubGit.worktreeCalls[0]?.newBranch).toMatch(/phase-1-planner/);

    await system.dispose();
  });

  it("does NOT dispatch Phase 2's Planning Node while Phase 1's Planning Node is still pending", async () => {
    const projectId = "project-kind-2";
    const runId = "run-kind-2";
    const system = await createSchedulerSystem("t3-scheduler-kind-2-");
    await seedProject(system.orchestrationEngine, projectId);
    await seedRunningWeaveRun(system.weaveEngine, {
      runId,
      projectId,
      blueprint: makeTwoPhaseMetaBlueprint(),
    });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.scheduler.drain;
        }),
      ),
    );

    // Only Phase 1's Planning Node dispatched; Phase 2's Planning Node is
    // gated by the kind-stratified check.
    expect(system.stubGit.getCallCount()).toBe(1);
    const projection = await system.run(system.weaveEngine.getWeaveRun(WeaveRunId.make(runId)));
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-2-planner"))?.status).toBe("pending");

    await system.dispose();
  });

  it("dispatches Phase 2's Planning Node once every Phase 1 node is verified", async () => {
    const projectId = "project-kind-3";
    const runId = "run-kind-3";
    const system = await createSchedulerSystem("t3-scheduler-kind-3-");
    await seedProject(system.orchestrationEngine, projectId);
    await seedRunningWeaveRun(system.weaveEngine, {
      runId,
      projectId,
      blueprint: makeTwoPhaseMetaBlueprint(),
    });

    // Manually mark phase-1-planner verified via a system event so the
    // kind-stratified check unblocks Phase 2.
    await system.run(
      system.orchestrationEngine.appendSystemEvent({
        eventId: EventId.make(crypto.randomUUID()),
        aggregateKind: "weave",
        aggregateId: WeaveRunId.make(runId),
        type: "weave.node-verified",
        occurredAt: now(),
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          weaveRunId: WeaveRunId.make(runId),
          nodeId: WeaveNodeId.make("phase-1-planner"),
          verifierOutcome: "ok",
          occurredAt: now(),
        },
      }),
    );

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.scheduler.drain;
        }),
      ),
    );

    // Both planning nodes have been dispatched (Phase 1 at run start, Phase
    // 2 after Phase 1's planner verified).
    expect(system.stubGit.getCallCount()).toBe(2);
    const branches = system.stubGit.worktreeCalls.map((c) => c.newBranch ?? "");
    expect(branches.some((b) => b.includes("phase-1-planner"))).toBe(true);
    expect(branches.some((b) => b.includes("phase-2-planner"))).toBe(true);

    await system.dispose();
  });

  it("Tasks (kind != 'planning') still use dependsOn-based ready check", async () => {
    // This is a regression check. Reuse the existing 2-node blueprint helper
    // (makeTwoNodeBlueprint, which has node-a + node-b where b depends on a,
    // both kind 'raw'). Ensure node-a dispatches first; node-b only after a
    // is verified.
    const projectId = "project-kind-4";
    const runId = "run-kind-4";
    const system = await createSchedulerSystem("t3-scheduler-kind-4-");
    await seedProject(system.orchestrationEngine, projectId);
    await seedRunningWeaveRun(system.weaveEngine, {
      runId,
      projectId,
      blueprint: makeTwoNodeBlueprint(),
    });

    await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* system.scheduler.start();
          yield* Effect.sleep("20 millis");
          yield* system.scheduler.drain;
        }),
      ),
    );

    // Only node-a dispatched (node-b waits on node-a verifying).
    expect(system.stubGit.getCallCount()).toBe(1);
    expect(system.stubGit.worktreeCalls[0]?.newBranch).toMatch(/node-a/);

    await system.dispose();
  });
});
```

The helpers `createSchedulerSystem`, `seedProject`, `seedRunningWeaveRun`, `makeTwoNodeBlueprint`, `now`, `WeaveRunId`, `WeaveNodeId`, `WeavePhaseId`, `BlueprintVersion`, `Blueprint`, `Schema`, `Effect`, `EventId` should already be imported / defined at the top of `WeaveScheduler.test.ts`. If `EventId` is missing, add it to the existing `@t3tools/contracts` import.

- [ ] **Step 2: Run the scheduler tests and watch the new ones fail**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/WeaveScheduler.test.ts`

Expected: tests 1 and 4 (regression checks) pass already. Tests 2 and 3 fail: under the existing `computeReadySet`, both Planning Nodes are "ready" at run start (empty `dependsOn`), so the scheduler dispatches both in test 2 (`getCallCount()` = 2 instead of 1). Test 3 may or may not happen to pass for the wrong reason (both still ready) — verify.

- [ ] **Step 3: Update `computeReadySet` to be kind-aware**

In `apps/server/src/orchestration/Layers/WeaveScheduler.ts`, replace `computeReadySet` (lines 50–56) with:

```ts
/**
 * Compute the set of nodes that are ready to be dispatched.
 *
 * Kind-stratified:
 * - **Tasks** (kind: "raw" | "scaffold" | "contract" | "utility"): ready iff
 *   status is "pending" AND every entry in `dependsOn` is "verified".
 * - **Planning Nodes** (kind: "planning"): ready iff status is "pending" AND
 *   every other node in a strictly-earlier Phase (by ordinal) is "verified".
 *   This enforces the design's "Phase N's Planning Node dispatches when Phase
 *   N-1 is fully verified" rule without requiring the meta-planner to
 *   declare cross-Phase dependsOn (it can't — the prior Phase's Tasks don't
 *   exist yet at meta-plan time).
 */
function computeReadySet(run: WeaveRunProjection): WeaveNode[] {
  if (run.currentBlueprint === null) return [];
  const blueprint = run.currentBlueprint;

  const phaseOrdinalById = new Map<string, number>();
  for (const phase of blueprint.phases) {
    phaseOrdinalById.set(phase.id, phase.ordinal);
  }

  return blueprint.nodes.filter((n) => {
    if (run.nodeMeta.get(n.id)?.status !== "pending") return false;

    if (n.kind === "planning") {
      const myOrdinal = phaseOrdinalById.get(n.phaseId) ?? 0;
      return blueprint.nodes.every((other) => {
        const otherOrdinal = phaseOrdinalById.get(other.phaseId) ?? 0;
        if (otherOrdinal >= myOrdinal) return true;
        return run.nodeMeta.get(other.id)?.status === "verified";
      });
    }

    return n.dependsOn.every((dep) => run.nodeMeta.get(dep)?.status === "verified");
  });
}
```

The function's signature stays the same — only the body changes. `WeaveNode` already has `kind` (Slice 1 schema) and `phaseId` fields, so the new branch typechecks without import changes.

Note: `WeaveRunProjection` is already imported at the top of the file via `import type { WeaveNode, WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";` — no change.

- [ ] **Step 4: Run the scheduler tests and confirm they all pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/Layers/WeaveScheduler.test.ts`

Expected: all four new tests PASS; all previously-passing scheduler tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/Layers/WeaveScheduler.ts apps/server/src/orchestration/Layers/WeaveScheduler.test.ts
git commit -m "feat(weave): scheduler dispatches Phase Planning Nodes by Phase-ordinal predecessor verification"
```

---

## Task 3: End-to-end integration test re-enabled

**Files:**

- Modify: `apps/server/src/orchestration/weaveIntegration.test.ts` (rewrite the test body; un-skip)

**Why this matters:** The integration test was skipped at Slice 2 because (a) the meta-plan blueprint shape changed (Planning Nodes only) and (b) the scheduler couldn't dispatch Planning Nodes. Slice 3 fixed (b)'s conformer side; Task 2 of this slice fixes the scheduler side. Now the full chain works and the test can drive it end-to-end.

The new test exercises a 2-Phase meta-plan:

1. Stub `PlannerDriver` returns the meta-Blueprint JSON: 2 Phases, each with one Planning Node, no Tasks.
2. The test dispatches `weave.create` → planner reactor compiles → `weave.blueprint-compiled (initial, v1)` → run goes to `reviewing`.
3. Test dispatches `weave.blueprint.approve { version: 1 }` → run goes to `running`.
4. Scheduler picks up `weave.blueprint-approved` → dispatches Phase 1's Planning Node (kind-stratified ready check) → child thread created.
5. **Smart turn driver** detects the child thread's `thread.turn-start-requested` event:
   - For a Planning Node child thread: injects an assistant message with the appropriate `PhasePlannerOutput` JSON for that Phase, then dispatches `thread.session.set { status: "ready", activeTurnId: null }`.
   - For a Task child thread: just dispatches `thread.session.set { status: "ready", activeTurnId: null }`.
6. Conformer trigger fires for Phase 1's Planning Node → reads JSON → dispatches `weave.blueprint.extend` → decider emits `node-verified` + `extended` + `compiled (v2, phase-planning)` → projector applies (run goes to `reviewing`, `nodeMeta` preserves planner's `verified`).
7. **Approval driver** (in the test) polls for `run.status === "reviewing"` and dispatches `weave.blueprint.approve { version: nextVersion }`.
8. Run goes to `running` → scheduler dispatches Phase 1's first Task → smart turn driver triggers verifier → conformer runs `ProcessRunner` (stubbed, exit 0) → dispatches `weave.node.verified`.
9. After Phase 1's last Task verifies, scheduler dispatches Phase 2's Planning Node (kind-stratified ready check now passes; Phase 1 fully verified).
10. Phase 2 emits its Tasks; approval driver approves v3; Phase 2 Tasks verify → run completes.

Test asserts: run reaches `complete`, the right number of `createWorktree` and `ProcessRunner.run` calls fired, all node statuses are `verified`.

The test runs under a polling loop with a generous deadline (the existing 30-second poll pattern).

Bookkeeping notes for the implementer:

- The conformer triggers on `thread.session-set` events (where `status === "ready"` AND `activeTurnId === null`). NOT on `turn.processing.quiesced` receipts. The previously-skipped test's quiesce-receipt driver is part of why it was broken; this rewrite drops the receipt-bus driver entirely and instead dispatches `thread.session.set` directly. Keep this in mind: the `RuntimeReceiptBus` is no longer needed for the conformer's trigger path here, but other code may still depend on it; leave it in the layer composition.
- The smart turn driver subscribes to `thread.turn-start-requested` events and, for each event, looks up the child thread's owning Weave node via the projection's `childThreads` map (reverse lookup: thread id → node id). Then it consults a planner-output map (`Map<WeaveNodeId, string | null>`): `string` means "this is a planning node, inject this JSON", `null` means "this is a task, just dispatch session-ready".

- [ ] **Step 1: Replace the test file body**

Open `apps/server/src/orchestration/weaveIntegration.test.ts` and replace its entire contents (after the leading import comments) with the following. Preserve the existing top-of-file file-level docstring at the very top — it's accurate as a class of test, just the implementation differs:

```ts
/**
 * End-to-end integration test: Weave Run with incremental planning completes.
 *
 * Drives a 2-Phase meta-plan flow through the full reactor stack:
 *  - Real OrchestrationEngine + WeaveEngine + WeaveScheduler + WeaveContractConformer + WeavePlanner
 *  - Stub PlannerDriver: returns the meta-Blueprint (2 Phases, 2 Planning Nodes, 0 Tasks)
 *  - Stub ProcessRunner: returns exit 0 for every verifier invocation
 *  - Stub GitCore: records createWorktree calls; returns fake paths
 *  - Smart turn driver: subscribes to thread.turn-start-requested. For each
 *    event, looks up the owning Weave node. If kind === "planning", injects an
 *    assistant message with the appropriate PhasePlannerOutput JSON. Then
 *    dispatches thread.session.set { status: "ready" } — the conformer's
 *    trigger event.
 *  - Approval driver: polls for run.status === "reviewing" and dispatches
 *    weave.blueprint.approve at the current version.
 *
 * Flow proven:
 *   create → meta-compile (v1) → approve v1
 *     → P1 planner dispatches → emits Tasks → blueprint-extend (v2) → reviewing
 *     → approve v2 → P1 Tasks verify
 *     → P2 planner dispatches (kind-stratified ready check) → emits Tasks
 *     → blueprint-extend (v3) → reviewing
 *     → approve v3 → P2 Tasks verify → run "complete"
 */
import {
  Blueprint,
  BlueprintVersion,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
  type WeaveRunProjection,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../project/Layers/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../config.ts";
import { GitCore, type GitCoreShape } from "../git/Services/GitCore.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusLive } from "./Layers/RuntimeReceiptBus.ts";
import { WeaveContractConformerLive } from "./Layers/WeaveContractConformer.ts";
import { WeaveEngineLive } from "./Layers/WeaveEngine.ts";
import { WeavePlannerLive } from "./Layers/WeavePlanner.ts";
import { WeaveSchedulerLive } from "./Layers/WeaveScheduler.ts";
import { PlannerDriver, PlannerDriverError } from "./Services/PlannerDriver.ts";
import {
  ProcessRunner,
  type ProcessRunnerShape,
  type ProcessRunnerResult,
} from "./Services/ProcessRunner.ts";
import { WeaveContractConformer } from "./Services/WeaveContractConformer.ts";
import { WeaveEngineService } from "./Services/WeaveEngine.ts";
import { WeaveScheduler } from "./Services/WeaveScheduler.ts";
import { WeavePlanner } from "./Services/WeavePlanner.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

const FAKE_WORKSPACE_ROOT = "/tmp/fake-workspace-e2e";

// ── 2-Phase meta-blueprint ───────────────────────────────────────────────────

function makeMetaBlueprintJson(): { rawJson: string } {
  const phase1Id = WeavePhaseId.make("phase-1");
  const phase2Id = WeavePhaseId.make("phase-2");
  const blueprint = Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(1),
    nodes: [
      {
        id: WeaveNodeId.make("phase-1-planner"),
        title: "Phase 1 Planner",
        description: "Plan Phase 1",
        kind: "planning",
        phaseId: phase1Id,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "PhasePlannerOutput JSON",
        dependsOn: [],
        status: "pending",
      },
      {
        id: WeaveNodeId.make("phase-2-planner"),
        title: "Phase 2 Planner",
        description: "Plan Phase 2",
        kind: "planning",
        phaseId: phase2Id,
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
        id: phase1Id,
        ordinal: 0,
        title: "Phase 1",
        description: "First Phase",
        approval: "pending",
      },
      {
        id: phase2Id,
        ordinal: 1,
        title: "Phase 2",
        description: "Second Phase",
        approval: "pending",
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: now(),
    compiledBy: "planner",
  });
  return { rawJson: JSON.stringify(Schema.encodeSync(Blueprint)(blueprint)) };
}

/**
 * The Phase-Planner JSON output for Phase 1: a single Task that depends on the
 * planner node. Note `kind: "raw"` (not `"planning"` — Slice 3 forbids
 * recursion); `phaseId: "phase-1"` (must equal the planner's phase).
 */
function phase1PlannerOutput(): string {
  return JSON.stringify({
    addedNodes: [
      {
        id: "phase-1-task-1",
        title: "Phase 1 Task",
        description: "First task in Phase 1",
        kind: "raw",
        phaseId: "phase-1",
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: ["phase-1-planner"],
        status: "pending",
      },
    ],
  });
}

function phase2PlannerOutput(): string {
  return JSON.stringify({
    addedNodes: [
      {
        id: "phase-2-task-1",
        title: "Phase 2 Task",
        description: "First task in Phase 2",
        kind: "raw",
        phaseId: "phase-2",
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "All tests pass",
        dependsOn: ["phase-2-planner"],
        status: "pending",
      },
    ],
  });
}

// ── Stub PlannerDriver ────────────────────────────────────────────────────────

function makeStubPlannerDriver(outputs: ReadonlyArray<string | Error>): Layer.Layer<PlannerDriver> {
  let callIndex = 0;
  return Layer.succeed(
    PlannerDriver,
    PlannerDriver.of({
      compile: (_input) => {
        const idx = callIndex++;
        const output = outputs[idx];
        if (output === undefined) {
          return Effect.fail(
            new PlannerDriverError({ reason: "stub: no more outputs configured" }),
          );
        }
        if (output instanceof Error) {
          return Effect.fail(new PlannerDriverError({ reason: output.message }));
        }
        return Effect.succeed(output);
      },
    }),
  );
}

// ── Stub ProcessRunner ────────────────────────────────────────────────────────

function makeStubProcessRunner(result: ProcessRunnerResult) {
  let runCount = 0;
  const stubShape: ProcessRunnerShape = {
    run: (_input) => {
      runCount++;
      return Effect.succeed(result);
    },
  };
  return {
    layer: Layer.succeed(ProcessRunner, ProcessRunner.of(stubShape)),
    getRunCount: () => runCount,
  };
}

// ── Stub GitCore ──────────────────────────────────────────────────────────────

function makeStubGitCore() {
  const worktreeCalls: string[] = [];
  const stubShape: GitCoreShape = {
    createWorktree: (input) => {
      const branch = input.newBranch ?? input.branch;
      worktreeCalls.push(branch);
      return Effect.succeed({
        worktree: { path: `/tmp/weave-test-${branch}`, branch },
      });
    },
    execute: () => Effect.die(new Error("stub: execute not implemented")),
    status: () => Effect.die(new Error("stub: status not implemented")),
    statusDetails: () => Effect.die(new Error("stub: statusDetails not implemented")),
    statusDetailsLocal: () => Effect.die(new Error("stub: statusDetailsLocal not implemented")),
    prepareCommitContext: () => Effect.die(new Error("stub: prepareCommitContext not implemented")),
    commit: () => Effect.die(new Error("stub: commit not implemented")),
    pushCurrentBranch: () => Effect.die(new Error("stub: pushCurrentBranch not implemented")),
    readRangeContext: () => Effect.die(new Error("stub: readRangeContext not implemented")),
    readConfigValue: () => Effect.die(new Error("stub: readConfigValue not implemented")),
    isInsideWorkTree: () => Effect.die(new Error("stub: isInsideWorkTree not implemented")),
    listWorkspaceFiles: () => Effect.die(new Error("stub: listWorkspaceFiles not implemented")),
    filterIgnoredPaths: () => Effect.die(new Error("stub: filterIgnoredPaths not implemented")),
    listBranches: () => Effect.die(new Error("stub: listBranches not implemented")),
    pullCurrentBranch: () => Effect.die(new Error("stub: pullCurrentBranch not implemented")),
    fetchPullRequestBranch: () =>
      Effect.die(new Error("stub: fetchPullRequestBranch not implemented")),
    ensureRemote: () => Effect.die(new Error("stub: ensureRemote not implemented")),
    fetchRemoteBranch: () => Effect.die(new Error("stub: fetchRemoteBranch not implemented")),
    setBranchUpstream: () => Effect.die(new Error("stub: setBranchUpstream not implemented")),
    removeWorktree: () => Effect.die(new Error("stub: removeWorktree not implemented")),
    renameBranch: () => Effect.die(new Error("stub: renameBranch not implemented")),
    createBranch: () => Effect.die(new Error("stub: createBranch not implemented")),
    checkoutBranch: () => Effect.die(new Error("stub: checkoutBranch not implemented")),
    initRepo: () => Effect.die(new Error("stub: initRepo not implemented")),
    listLocalBranchNames: () => Effect.die(new Error("stub: listLocalBranchNames not implemented")),
  };
  return {
    layer: Layer.succeed(GitCore, GitCore.of(stubShape)),
    worktreeCalls,
  };
}

// ── System factory ────────────────────────────────────────────────────────────

async function createE2ESystem(testPrefix: string) {
  const { rawJson } = makeMetaBlueprintJson();
  const stubPlannerDriverLayer = makeStubPlannerDriver([rawJson]);
  const stubProcessRunner = makeStubProcessRunner({
    exitCode: 0,
    stdout: "All tests passed\n",
    stderr: "",
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  const stubGit = makeStubGitCore();

  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), { prefix: testPrefix });

  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolverLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const weaveEngineLayer = WeaveEngineLive.pipe(Layer.provide(orchestrationLayer));
  const receiptBusLayer = RuntimeReceiptBusLive;

  const plannerLayer = WeavePlannerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubPlannerDriverLayer),
  );

  const schedulerLayer = WeaveSchedulerLive.pipe(
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubGit.layer),
  );

  const conformerLayer = WeaveContractConformerLive.pipe(
    Layer.provide(receiptBusLayer),
    Layer.provide(weaveEngineLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(stubProcessRunner.layer),
  );

  const appLayer = conformerLayer.pipe(
    Layer.provideMerge(schedulerLayer),
    Layer.provideMerge(plannerLayer),
    Layer.provideMerge(receiptBusLayer),
    Layer.provideMerge(weaveEngineLayer),
    Layer.provideMerge(orchestrationLayer),
  );

  const runtime = ManagedRuntime.make(appLayer);
  const services = await runtime.runPromise(
    Effect.gen(function* () {
      return {
        conformer: yield* WeaveContractConformer,
        scheduler: yield* WeaveScheduler,
        planner: yield* WeavePlanner,
        weaveEngine: yield* WeaveEngineService,
        orchestrationEngine: yield* OrchestrationEngineService,
      };
    }),
  );

  return {
    ...services,
    stubProcessRunner,
    stubGit,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

// ── Smart turn driver ────────────────────────────────────────────────────────

/**
 * For each thread.turn-start-requested:
 *  - Look up the owning Weave node from the projection.
 *  - If the node is `kind: "planning"`, find its planner output in the map
 *    and append an assistant message with that JSON.
 *  - Then dispatch `thread.session.set { status: "ready", activeTurnId: null }`
 *    — the conformer's trigger event.
 *
 * The `plannerOutputs` map keys by node id; the value is the JSON string the
 * Phase Planner agent would emit. For a Task node the key is omitted (no
 * injection needed).
 */
function startSmartTurnDriver(
  system: Awaited<ReturnType<typeof createE2ESystem>>,
  plannerOutputs: ReadonlyMap<string, string>,
  weaveRunId: WeaveRunId,
) {
  return Effect.forkScoped(
    Stream.runForEach(
      system.orchestrationEngine.streamDomainEvents.pipe(
        Stream.filter(
          (e): e is Extract<typeof e, { type: "thread.turn-start-requested" }> =>
            e.type === "thread.turn-start-requested",
        ),
      ),
      (event) =>
        Effect.gen(function* () {
          const threadId = event.payload.threadId;
          // Reverse-lookup: find the owning Weave node by walking childThreads.
          const projection = yield* system.weaveEngine.getWeaveRun(weaveRunId);
          if (projection === null) return;
          const ownerNodeId = findOwningNode(projection, threadId);
          if (ownerNodeId === null) return;

          const plannerJson = plannerOutputs.get(ownerNodeId);
          if (plannerJson !== undefined) {
            yield* system.orchestrationEngine.appendSystemEvent({
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
                text: plannerJson,
                turnId: null,
                streaming: false,
                createdAt: now(),
                updatedAt: now(),
              },
            });
          }

          // Dispatch session.set with status "ready" — the conformer's
          // trigger event.
          yield* system.orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`cmd-session-set-${crypto.randomUUID()}`),
            threadId,
            session: {
              threadId,
              status: "ready",
              providerName: "stub",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: now(),
            },
            createdAt: now(),
          });
        }),
    ),
  );
}

function findOwningNode(projection: WeaveRunProjection, threadId: ThreadId): string | null {
  for (const [nodeId, entry] of projection.childThreads) {
    if (entry.threadId === threadId) return nodeId as string;
  }
  return null;
}

// ── Approval driver ──────────────────────────────────────────────────────────

/**
 * Polls for run.status === "reviewing"; when found, dispatches
 * weave.blueprint.approve at the current Blueprint version. Stops when the
 * run is terminal (complete / failed / aborted).
 */
function startApprovalDriver(
  system: Awaited<ReturnType<typeof createE2ESystem>>,
  weaveRunId: WeaveRunId,
  approvedVersions: { current: Set<number> },
) {
  return Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep("30 millis");
        const projection = yield* system.weaveEngine.getWeaveRun(weaveRunId);
        if (projection === null) continue;
        const status = projection.run.status;
        if (status === "complete" || status === "failed" || status === "aborted") return;
        if (status !== "reviewing") continue;
        const version = projection.currentBlueprint?.version;
        if (version === undefined) continue;
        if (approvedVersions.current.has(version as number)) continue;
        approvedVersions.current.add(version as number);
        yield* system.weaveEngine.dispatchWeaveCommand({
          type: "weave.blueprint.approve",
          commandId: CommandId.make(`cmd-approve-${version}-${crypto.randomUUID()}`),
          weaveRunId,
          blueprintVersion: version,
          concurrencyCap: 1,
          createdAt: now(),
        });
      }
    }),
  );
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe("Weave Run end-to-end (incremental planning)", () => {
  it("completes a 2-Phase meta-plan run from create to complete", async () => {
    const projectId = "project-e2e-1";
    const runId = WeaveRunId.make("run-e2e-1");

    const system = await createE2ESystem("t3-weave-e2e-incremental-1-");

    const plannerOutputs = new Map<string, string>([
      ["phase-1-planner", phase1PlannerOutput()],
      ["phase-2-planner", phase2PlannerOutput()],
    ]);
    const approvedVersions = { current: new Set<number>() };

    const projection = await system.run(
      Effect.scoped(
        Effect.gen(function* () {
          // Start all reactors.
          yield* system.planner.start();
          yield* system.scheduler.start();
          yield* system.conformer.start();
          yield* Effect.sleep("30 millis"); // let subscribers attach

          // Seed project.
          yield* system.orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`cmd-project-${projectId}`),
            projectId: ProjectId.make(projectId),
            title: "E2E Test Project",
            workspaceRoot: FAKE_WORKSPACE_ROOT,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            createdAt: now(),
          });

          // Start the smart turn driver and approval driver.
          yield* startSmartTurnDriver(system, plannerOutputs, runId);
          yield* startApprovalDriver(system, runId, approvedVersions);

          // Create the Weave Run. Planner reactor calls the stub driver and
          // emits weave.blueprint-compiled (v1, initial) → run goes to
          // "reviewing". Approval driver picks it up and approves v1 → run
          // goes to "running". Scheduler dispatches Phase 1's Planning Node.
          // Smart turn driver injects Phase 1's planner output and dispatches
          // session.ready. Conformer reads JSON, dispatches
          // weave.blueprint.extend. Decider emits node-verified + extended +
          // compiled (v2, phase-planning) → reviewing. Approval driver
          // approves v2 → running. Scheduler dispatches Phase 1 Task. Smart
          // turn driver dispatches session.ready (no JSON injection — Task).
          // Conformer runs verifier (stub exit 0) → node-verified. Phase 1
          // complete → scheduler dispatches Phase 2's Planning Node. … and so
          // on until run "complete".
          yield* system.weaveEngine.dispatchWeaveCommand({
            type: "weave.create",
            commandId: CommandId.make("cmd-e2e-create"),
            weaveRunId: runId,
            projectId: ProjectId.make(projectId),
            title: "Incremental Planning E2E",
            vision: "Build something across two phases",
            createdAt: now(),
          });

          // Poll for "complete".
          const deadline = Date.now() + 30_000;
          let delay = 30;
          while (Date.now() < deadline) {
            const p = yield* system.weaveEngine.getWeaveRun(runId);
            if (p?.run.status === "complete") break;
            yield* Effect.sleep(`${delay} millis`);
            delay = Math.min(Math.round(delay * 1.5), 500);
          }

          return yield* system.weaveEngine.getWeaveRun(runId);
        }),
      ),
    );

    expect(projection).not.toBeNull();
    expect(projection?.run.status).toBe("complete");

    // All four nodes are verified.
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-1-planner"))?.status).toBe("verified");
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-1-task-1"))?.status).toBe("verified");
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-2-planner"))?.status).toBe("verified");
    expect(projection?.nodeMeta.get(WeaveNodeId.make("phase-2-task-1"))?.status).toBe("verified");

    // Worktrees: 4 (one per node).
    expect(system.stubGit.worktreeCalls).toHaveLength(4);

    // Verifier: ran twice (once per Task; not for Planning Nodes).
    expect(system.stubProcessRunner.getRunCount()).toBe(2);

    // Approval driver fired 3 times: v1 (initial), v2 (Phase 1 emission),
    // v3 (Phase 2 emission).
    expect(approvedVersions.current).toEqual(new Set([1, 2, 3]));

    // Child threads: 4 (one per node).
    expect(projection?.childThreads.size).toBe(4);

    await system.dispose();
  }, 60_000);
});
```

Note: this rewrite removes the previous file's `RuntimeReceiptBus` import since the smart turn driver no longer needs it; the conformer's trigger is `thread.session-set`, not a quiesce receipt. The `RuntimeReceiptBusLive` Layer is still provided to the conformer because the conformer's source still imports it for other internal wiring, but we no longer interact with it from the test.

- [ ] **Step 2: Run the integration test in isolation**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveIntegration.test.ts`

Expected: PASS. The test runs for under 30 seconds; the polling loop drives the projection to `"complete"`.

If it fails, check:

- The projection's `run.status` at the deadline. If it's stuck in `"reviewing"`, the approval driver isn't firing — verify the polling loop sees the right version.
- The child thread count. If it's < 4, the scheduler didn't dispatch all four nodes — verify the kind-stratified ready check from Task 2.
- The `nodeMeta` of the planner nodes. If they're `"pending"` after the compile, the projector preservation from Task 1 didn't land.
- The `worktreeCalls` length. If it's < 4, the smart turn driver isn't dispatching session.ready for some thread — check the reverse-lookup `findOwningNode`.
- The Phase 2 planner's `nodeMeta` after Phase 1 completes. If still `"pending"`, the kind-stratified ready check didn't trigger Phase 2's dispatch.

Common pitfalls — **escalate if you hit any of these and can't resolve in 5 minutes**:

- Race between the planner reactor and the approval driver (the approval driver fires before the planner is finished compiling). The 30ms initial sleep should cover this; if not, increase the initial sleep.
- The conformer trigger missing the `thread.session-set` event (timing race). Increase initial reactor-attach sleep to 50ms.
- The smart turn driver firing for `thread.turn-start-requested` events from Tasks that don't have a planner-output entry — that's expected; only Planning Nodes have entries. Just dispatch session.ready.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/orchestration/weaveIntegration.test.ts
git commit -m "test(weave): re-enable end-to-end integration test for incremental planning"
```

---

## Task 4: Whole-repo verification

**Files:** No file changes expected. Verification only; if any guard fixes are needed, they get a separate commit.

- [ ] **Step 1: Repo-wide typecheck**

Run from the repo root: `bun typecheck`

Expected: PASS for all 10 packages.

- [ ] **Step 2: Repo-wide tests**

Run from the repo root: `bun run test`

Expected baseline shift relative to Slice 3:

- Slice 3 actual: 1026 passed / 5 skipped / 7 failed.
- Slice 4 expected: ≥1033 passed / 4 skipped / 7 failed. Breakdown:
  - **+2 new passing tests** from Task 1 (the two `nodeMeta`-preservation projector tests). The tightened Slice 3 conformer test was already passing on the relaxed assertion, so it's a +0 in pass count — only the assertion changes.
  - **+4 new passing tests** from Task 2 (kind-stratified ready check).
  - **+1 new passing test** from Task 3 (the un-skipped integration test). Skipped count drops by 1.

These are floor estimates. If your actual numbers are higher, that's fine — verify nothing regresses by confirming the failure list still matches the GitManager network-timeout family.

If new tests fail outside the pre-existing GitManager list, treat as a regression and STOP. Report which tests failed and what their failure mode looks like.

- [ ] **Step 3: Lint and format**

Run from the repo root: `bun lint && bun fmt`

Expected: lint passes (warnings are pre-existing and acceptable; errors are not). `bun fmt` may reformat files this slice touched — accept those.

If `bun fmt` reformats files OUTSIDE this slice's scope (i.e., docs files, other packages' source not modified by Tasks 1–3, files unrelated to weave), do NOT include them. Revert with `git checkout -- <path>`.

- [ ] **Step 4: Commit any guard fixes (only if needed)**

If `bun fmt` reformatted any in-scope files, stage and commit them as:

```bash
git add <files>
git commit -m "style(weave): apply bun fmt to slice 4 files"
```

If no fmt fixups were needed, skip this step. Slice 4 ends with the three task commits from Tasks 1–3.

---

## Self-review checklist

Run through this once Task 4 is done.

- **Spec coverage.** Every Slice 4 deliverable from the design doc maps to a task here:
  - Auto-dispatch of next-Phase Planning Node on Phase completion → Task 2 (kind-stratified ready check)
  - Per-Phase gate fires at version-bump-after-Phase-Planner → Task 3 (already exercised by the existing `weave.blueprint-compiled` projector arm; the integration test's approval driver simulates the user)
  - Projector preservation of `nodeMeta` (Slice 3 deferral) → Task 1
  - Re-enable `weaveIntegration.test.ts` → Task 3
  - Whole-repo gates → Task 4

- **No placeholder language.** No `TBD`, `TODO`, "implement later," or vague "add validation"-style steps.

- **Type consistency.** Field names, helper names, and signatures match between tasks:
  - `nodeMeta` (Map keyed by `WeaveNodeId`) — referenced by Task 1's projector body and the assertion in Task 1 Step 5 and Task 3 assertions.
  - `phaseOrdinalById` (Task 2) is a fresh local Map; no consumer outside `computeReadySet`.
  - `findOwningNode` (Task 3 helper) walks `projection.childThreads` (a `ReadonlyMap<WeaveNodeId, { threadId, worktreePath }>`).
  - `plannerOutputs` is `Map<string, string>` keyed by node-id-as-string.

- **Out-of-scope hold.** Slice 5's web work is NOT touched. The decider for `weave.blueprint.extend` is NOT modified. `WeaveContractConformer.ts` (the source) is NOT modified — only its test is tightened. Mid-Phase recursion stays rejected. The `WeavePlanner → MetaPlanner` rename is NOT performed.

- **Commit hygiene.** Three small commits for Tasks 1–3, plus optionally a fourth from Task 4 if `bun fmt` had to reformat any in-scope files.

---

## What ships at end of Slice 4

End-to-end traversal of an incremental-planning Run works under stub drivers: `create → meta-compile → approve v1 → P1 planner → emit → reviewing → approve v2 → P1 tasks → P2 planner auto-dispatch → emit → reviewing → approve v3 → P2 tasks → complete`.

Two pieces remain before the feature is user-visible: (1) the live `PhasePlannerDriver` Layer that wires `ProviderService.sendTurn` to a Phase Planner agent (currently the integration test injects assistant messages manually); (2) the web UI multi-gate approval UX (Slice 5). Both are independent of Slice 4's mechanics.
