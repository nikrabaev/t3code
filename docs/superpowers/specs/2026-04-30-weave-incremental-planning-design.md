# Incremental planning — design

**Status:** Draft for review.
**Scope:** Replace v0.1's one-shot planner with phase-by-phase incremental planning. Verifier work is parked separately (see [verification-design.md](../../weave/verification-design.md)).

Read [concepts.md](../../weave/concepts.md), [architecture.md](../../weave/architecture.md), and [v0.1-spec.md](../../weave/v0.1-spec.md) first — this design assumes that vocabulary.

## Summary

Today, `WeavePlanner` runs once at intake and emits a complete Blueprint. With incremental planning, planning becomes a kind of Node that the scheduler dispatches like any other. A meta-planner emits the Phase list once. Each Phase then carries a **Planning Node** at its head; when that Planning Node runs, it emits the rest of its Phase's sub-DAG against the actual repo state. The Blueprint grows over time rather than being authored up front.

## Motivation

The current planner has to imagine all phases at intake time, before any code exists. Plans for Phase 2+ are necessarily speculative — the planner is guessing about a project that hasn't been scaffolded yet. Two consequences:

- **Wasted plan precision.** Phase 2 nodes are vague because the planner doesn't know the repo shape it'll be working in.
- **Plan staleness baked in.** By the time Phase 2 runs, the actual scaffolded repo often diverges from what Phase 1 was planned to produce, forcing replans.

Incremental planning defers detail to the moment when it can be informed by reality.

## User-facing lifecycle

```
/weave + Vision
   ↓
Meta-planner runs once.
   Emits a Blueprint with N Phases. Each Phase contains exactly one
   Planning Node. Zero Tasks at this stage.
   ↓
Phase 1 Planning Node dispatches automatically.
   Sees: Vision + current repo. Emits: a sub-DAG of Tasks (and optionally
   further Planning Nodes) appended under itself.
   ↓
GATE 1 — user reviews Phase 1's emitted plan.
   Buttons: Approve & run · Edit Vision · Re-plan Phase · Abort.
   ↓
Phase 1 Tasks execute. Mid-Phase Planning Nodes (if any) dispatch
   autonomously when their ancestors finish. No further user gates
   inside the Phase.
   ↓
Phase 1's last Task verifies → Phase 2 Planning Node dispatches automatically.
   Sees: Vision + completed-Phase outputs + current repo state.
   ↓
GATE 2 — user formally approves Phase 2's plan; Phase 1's outcome is
   visible in the UI but not separately gated (formal end-of-Phase
   outcome approval is a v0.3 concern, see Approval semantics below).
   ↓
… until the last Phase's last Task verifies → run complete.
```

The gate is **one per Phase boundary**, and fires _after_ the next Phase's Planning Node has materialized. The user is always reviewing a real plan, never an empty placeholder.

## Domain model changes

### `WeaveNodeKind` extension

```ts
export const WeaveNodeKind = Schema.Literals([
  "raw",
  "scaffold",
  "contract",
  "utility",
  "planning", // NEW — emits Blueprint extensions, not files
]);
```

A Planning Node's "output" is graph, not code. It runs in a worktree (uniform dispatch protocol) but its result is captured from the agent's structured JSON output, not from a file diff. The worktree is discarded after dispatch.

Planning Nodes emitted by the meta-planner are minimally specified: empty `scope` (no read/write set is meaningful — the planner reads, doesn't write), empty `inputContractIds` / `outputContractIds`, the Phase's id as `phaseId`, and a `verifierDescription` that names the schema the emission must conform to.

### `WeaveBlueprintCompileReason` extension

```ts
export const WeaveBlueprintCompileReason = Schema.Literals([
  "initial",
  "amendment",
  "redesign",
  "phase-planning", // NEW — a Planning Node emitted a sub-DAG
]);
```

Every Planning Node emission produces a new `BlueprintVersion`. The compile reason names what triggered it.

### `WeaveBlueprintExtendedPayload` (new event)

```ts
export const WeaveBlueprintExtendedPayload = Schema.Struct({
  weaveRunId: WeaveRunId,
  version: BlueprintVersion,
  plannerNodeId: WeaveNodeId,
  addedNodeIds: Schema.Array(WeaveNodeId),
  occurredAt: IsoDateTime,
});
```

Captures the delta caused by a single Planning Node's emission. The full new Blueprint also rides on the existing `WeaveBlueprintCompiledPayload` (so projections never reconstruct from deltas alone).

### `Blueprint` shape

Unchanged. Still a single versioned struct with `nodes`, `phases`, `contracts`, `decisions`. New versions append; nothing existing is removed by a Planning Node emission.

### Recursion cap

A new optional field on `WeaveRun`:

```ts
planningDepthCap: Schema.optional(NonNegativeInt),  // default: 3
```

Counts: meta-plan = depth 0; a Phase Planning Node it emits = depth 1; a mid-Phase Planning Node that one emits = depth 2; etc. A Planning Node at depth `cap` may not emit further Planning Nodes — its emission is rejected with a runaway-guard error if it tries.

## Component changes

| Component                | Change                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WeavePlanner`           | Split into `MetaPlanner` (Vision → Phase list with Planning Nodes only) and `PhasePlanner` (the per-Node planner agent invoked when a Planning Node dispatches). Both reuse the existing `ProviderService` path. |
| `plannerPrompt.ts`       | Two new prompt builders: `buildMetaPlannerPrompt` and `buildPhasePlannerPrompt`. Each emits a constrained JSON shape.                                                                                            |
| `WeaveDecider`           | New transitions for `weave.blueprint.extend` (a Planning Node's emission becomes a new Blueprint version). Existing transitions preserved.                                                                       |
| `WeaveProjector`         | Append-only Blueprint version handling; surface `pendingPlanningNodes` so the scheduler can pick them up.                                                                                                        |
| `WeaveScheduler`         | Dispatch Planning Nodes the same way it dispatches Tasks. Recognize "Planning Node verified → next Phase Planning Node ready" transitions.                                                                       |
| `WeaveContractConformer` | Special-case `kind === "planning"`: verifier is "schema-validate the agent's emitted JSON against the Blueprint-extension schema." No commands run, no worktree diff inspection.                                 |
| `WeaveDispatcher`        | Capture structured JSON output from Planning Node child threads; route it into the extend-Blueprint flow.                                                                                                        |
| Web                      | `WeaveBlueprintList` renders Planning Nodes inline with Tasks (kind badge `planning`). Approve flow surfaces at each Phase boundary, not only at intake.                                                         |

The `WeaveContractConformer` change is the smallest viable cut: it doesn't need the kind-stratified verifier from the parked Phase A — it just needs to know that `planning` Nodes verify by schema, not by command.

## Control flow

A typical Run, Phase by Phase:

1. **Intake.** `weave.create` → `weave.blueprint.compile { reason: "initial" }` → meta-planner runs → `weave.blueprint-compiled` (version 1: N Phases, N Planning Nodes, 0 Tasks).
2. **Phase 1 dispatch.** Scheduler observes that Phase 1's Planning Node is `ready`. Emits `weave.node.dispatch`. Child thread runs the phase-planner agent.
3. **Phase 1 plan emission.** Agent quiesces. Conformer parses its JSON output as a Blueprint extension → `weave.blueprint.extend` command → `weave.blueprint-extended` + a new `weave.blueprint-compiled` (version 2: Phase 1 now has Tasks). Planning Node transitions to `verified`.
4. **Phase 1 gate.** UI surfaces the new Phase 1 plan. User clicks **Approve & run** → `weave.blueprint.approve { version: 2 }`.
5. **Phase 1 execution.** Tasks dispatch sequentially. Mid-Phase Planning Nodes dispatch autonomously when their ancestors finish, each producing a new Blueprint version (auto-promoted, no gate).
6. **Phase 1 complete.** All Phase 1 Tasks `verified`. Scheduler dispatches Phase 2's Planning Node automatically.
7. **Phase 2 plan emission.** Same as step 3.
8. **Phase 2 gate.** Same as step 4 — but this gate also surfaces Phase 1's outcome (smoke tests defer to v0.3).
9. **Loop until** the last Phase's last Task verifies → run `complete`.

### Why two events per planning emission?

`weave.blueprint-extended` is the lightweight delta event (cheap to consume, audit-friendly). `weave.blueprint-compiled` carries the full new Blueprint so projections never have to reconstruct state from deltas — same pattern v0.1 already uses for the initial compile. A Planning Node emission fires both: extended first, compiled second, both at version `n+1`.

## Approval semantics

**One gate per Phase boundary, fired post-Planning-Node-emission.** The gate is the existing `WeaveBlueprintApproveCommand`, applied to the _post-emission_ version. When the user approves version `n`, the Phase whose Planning Node produced version `n` becomes runnable.

Mid-Phase Planning Node emissions auto-promote — they bump `BlueprintVersion` and append Nodes, but the run keeps executing without a user gate. This honors the "Phase-only gates" decision: autonomy within a Phase even when the DAG mutates.

The existing `WeavePhaseApproveCommand` (end-of-Phase outcome approval) is an unrelated v0.3 mechanism and stays as-is.

### "Edit Vision" at a gate

Replays the meta-planner with the updated Vision + completed Phase outputs preserved as an immutable suffix. Phases not yet started are replanned. The new meta-plan is treated as a new initial compile (`reason: "redesign"`).

## Failure handling

| Failure                                               | Response                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning Node emits invalid JSON / wrong schema       | Conformer marks Node `failed`. Standard ladder applies: retry once with the validation error fed back into the prompt; on second failure, escalate to user.                                                 |
| Planning Node tries to emit beyond `planningDepthCap` | Conformer marks Node `failed` with a runaway-guard reason. User-visible: "Planning depth exceeded — reduce uncertainty or increase cap."                                                                    |
| Meta-planner emits zero Phases                        | Hard error at intake, treated like an invalid plan today.                                                                                                                                                   |
| Phase Planning Node emits zero Tasks                  | Allowed — that Phase becomes a no-op once approved. (Useful for Phases the meta-planner outlined but the Phase Planner concludes are unnecessary.)                                                          |
| User rejects a Phase's emitted plan                   | Same options as today's intake-time blueprint review: Edit Vision, Re-plan Phase, Abort. **Re-plan Phase** re-dispatches the Planning Node with a fresh worktree and the user's rejection rationale fed in. |

## Out of scope

These are intentionally not addressed and remain on the existing roadmap:

- **Verifier work.** Kind-stratified verification, Makefile / `.weave/verifiers.toml` interface, structural checks, contract-conformance tests, judge-LLM. Parked at the verification-design memo.
- **Phase smoke tests.** v0.3 work; doesn't change with this design.
- **PendingDecisions surfacing.** v0.3 work.
- **Parallel scheduling within a Phase.** Orthogonal to incremental planning; v0.2.
- **Mid-Phase Planning Node user gates.** Excluded by the "Phase-only" decision; revisit only if mid-Phase emissions surprise users in practice.

## Migration

This change replaces the v0.1 monolithic compile path. v0.1 isn't yet in production, so no on-the-fly migration is required — the new flow becomes the default. Existing v0.1 tests that assume "intake → full Blueprint → execute" need to be updated to "intake → meta-Blueprint → Planning Node dispatch → extended Blueprint → execute."

## Implementation slices

Suggested slicing for the implementation plan (refined further in writing-plans):

1. **Slice 1 — schema deltas.** `WeaveNodeKind`, `WeaveBlueprintCompileReason`, `WeaveBlueprintExtendedPayload`, `WeaveRun.planningDepthCap`. Tests.
2. **Slice 2 — meta-planner.** Split today's `WeavePlanner` into `MetaPlanner` + prompt. Returns Phases + Planning Nodes only. Existing intake → compile flow now produces this shape.
3. **Slice 3 — phase planner + extend flow.** New `PhasePlanner` prompt + decoder. New `weave.blueprint.extend` command. Decider + projector handling. Conformer schema-validation path for `kind === "planning"`.
4. **Slice 4 — scheduler integration.** Auto-dispatch of next-Phase Planning Node on Phase completion. Gate fires at version-bump-after-Phase-Planner.
5. **Slice 5 — web.** Render Planning Nodes; multi-gate approval UX; Edit Vision / Re-plan Phase wiring.

Each slice typechecks and tests on its own.

## Implementation status

### Slice 1 — schema deltas (SHIPPED, branch `nikrabaev/weave`)

Plan: [`docs/superpowers/plans/2026-04-30-weave-incremental-planning-slice-1.md`](../plans/2026-04-30-weave-incremental-planning-slice-1.md).
Range: `0d07409d..91f50760` (10 commits).

**Schemas now present in `packages/contracts/src/weave.ts`:**

- `WeaveNodeKind` includes `"planning"`.
- `WeaveBlueprintCompileReason` includes `"phase-planning"`.
- `WeaveRun.planningDepthCap: Schema.optional(NonNegativeInt)` — the field is optional at the schema layer; the design's "default 3" is **not** yet enforced anywhere. Slice 2 or 3 must add a runtime constructor / decider rule that supplies the default.
- `WeaveBlueprintExtendedPayload` (event payload).
- `WeaveBlueprintExtendCommand` (server-only internal command, type literal `"weave.blueprint.extend"`).
- `WeaveBlueprintExtendCommand` is in the `WeaveInternalCommand` union.

**Schemas now present in `packages/contracts/src/orchestration.ts`:**

- `OrchestrationEventType` includes `"weave.blueprint-extended"`; `OrchestrationEvent` union has the matching `Schema.Struct` variant.
- `WeaveBlueprintExtendCommand` is in `InternalOrchestrationCommand` (added during typecheck guard pass — was not in the original Slice 1 plan but was necessary so `WeaveCommand ⊆ OrchestrationCommand` continues to hold).

**Runtime no-ops added to make `bun typecheck` pass (do NOT delete in slice 2):**

- [`apps/server/src/orchestration/weaveDecider.ts`](../../../apps/server/src/orchestration/weaveDecider.ts) has `case "weave.blueprint.extend": return Effect.succeed([])` with a `TODO(slice-2)` comment. **Slice 2/3 implementer note:** when wiring the real handler, add `yield* requireRun({ projection, command })` first — every other substantive case in `decideWeaveCommand` does this and the no-op intentionally skips it.
- [`apps/server/src/orchestration/weaveProjector.ts`](../../../apps/server/src/orchestration/weaveProjector.ts) has `case "weave.blueprint-extended"` with the standard "null projection ⇒ `OrchestrationProjectorDecodeError`" guard, then returns state unchanged. The guard pattern matches the existing `weave.planner.thread-created` handler — reuse that template when implementing the real version handler.
- [`apps/server/src/orchestration/decider.ts`](../../../apps/server/src/orchestration/decider.ts) routes `"weave.blueprint.extend"` to the weave aggregate arm.
- [`apps/server/src/orchestration/Layers/OrchestrationEngine.ts`](../../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts) has `commandToAggregateRef` resolving `"weave.blueprint.extend"` → `aggregateKind: "weave"`.

**Runtime invariant preserved:** no code emits the new event, accepts the new command, or constructs a `kind: "planning"` Node. The `WeavePlanner` is unchanged and still emits the old monolithic Blueprint shape.

### Slice 2 — meta-planner (NEXT)

**Goal:** split `WeavePlanner` into `MetaPlanner` (Vision → Phase list with one Planning Node per Phase, zero Tasks) + prompt. The intake `weave.blueprint.compile { reason: "initial" }` flow now produces this shape. No `weave.blueprint.extend` is emitted yet — that is Slice 3.

**Files in scope:**

| File                                                                                                                                                                                                                              | Likely change                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/server/src/orchestration/Layers/WeavePlanner.ts`](../../../apps/server/src/orchestration/Layers/WeavePlanner.ts) (228 lines)                                                                                               | Rename internally to `MetaPlannerLive` (or keep `WeavePlannerLive` as the wiring shell and split out a `MetaPlanner` service). Emit `kind: "planning"` Nodes. |
| [`apps/server/src/orchestration/Layers/plannerPrompt.ts`](../../../apps/server/src/orchestration/Layers/plannerPrompt.ts) (132 lines)                                                                                             | Replace with `buildMetaPlannerPrompt`. Constrain the JSON output to Phases + one Planning Node per Phase.                                                     |
| [`apps/server/src/orchestration/Services/WeavePlanner.ts`](../../../apps/server/src/orchestration/Services/WeavePlanner.ts) (35 lines)                                                                                            | Possibly split into a `MetaPlanner` service interface; keep `WeavePlanner` as an alias if other code consumes it.                                             |
| [`apps/server/src/orchestration/Layers/WeavePlanner.test.ts`](../../../apps/server/src/orchestration/Layers/WeavePlanner.test.ts), [`plannerPrompt.test.ts`](../../../apps/server/src/orchestration/Layers/plannerPrompt.test.ts) | Update fixtures; new tests for the meta-plan shape.                                                                                                           |

**What's pre-wired (do not duplicate):** the `"planning"` literal, the `"phase-planning"` reason, and `planningDepthCap` are all already in the contracts. Just construct Nodes with `kind: "planning"` and (when applicable) emit `weave.blueprint.compile { reason: "phase-planning" }` once Slice 3 lands.

**Hazards:**

- **`apps/server/src/orchestration/weaveIntegration.test.ts` is broken on `main` and on the Slice 1 branch** — pre-existing failure unrelated to Slice 1 (commit `040f979f` switched the conformer's verifier from `"bun run test"` to `"npm run test"`, which the test's stub harness doesn't simulate). Slice 2 will need to update that integration test for the new meta-plan shape anyway; fix the conformer-signal regression at the same time. Don't be misled into thinking Slice 1 broke it.
- **`WeavePhase` and `WeaveContract` shapes are unchanged.** A meta-plan still emits Phases — it just emits Phases that contain exactly one Planning Node and zero Tasks. The Blueprint schema stays as-is.
- **The "default 3" for `planningDepthCap`.** Slice 1 only added the optional field. The runtime default has to live somewhere — either the `WeaveCreate` decider arm (most natural — fill in a default at run-creation time), or the Planning Node dispatch path (when checking `depth ≥ cap`). Pick a place and document it; the Slice 2 plan should specify which.
- **`WeaveContractConformer` does not yet recognize `kind === "planning"`.** It will treat a Planning Node like a Raw Node and try to verify it via command. Slice 2 doesn't dispatch Planning Nodes (no Slice 3 yet), but if any test path runs through the conformer with a `kind: "planning"` Node it will misbehave. Either Slice 2 adds the conformer no-op (a precursor of Slice 3's schema-validation path), or Slice 2 tests must avoid driving Planning Nodes through dispatch.

**Notes for the Slice 2 plan author:**

- The `WeaveBlueprintExtendCommand` no-op in `weaveDecider.ts` has a doctrine gap (skips `requireRun`). That's intentional for Slice 1 and is on Slice 3 to fix when the real handler lands. Slice 2 doesn't need to touch it.
- If Slice 2 ends up wanting to extend `OrchestrationEvent` further or add an additional internal command, follow the Slice 1 pattern: add to both `WeaveInternalCommand` (in `weave.ts`) AND `InternalOrchestrationCommand` (in `orchestration.ts`) — only the former isn't enough.
- The `"WeaveInternalCommand union decodes every variant"` test in `packages/contracts/src/weave.test.ts:683` already only covers 2 of 5 variants. If Slice 2 adds another variant or you update the test to actually cover every variant, that's a welcome cleanup.

### Slice 3 — phase planner + extend flow

Pre-wired by Slice 1: the command, the event, the projector + decider routing, and the projector null guard. Slice 3 fleshes out the decider arm (add `requireRun`, then bump `BlueprintVersion` and append nodes), the projector arm (apply the delta), and the `WeavePhasePlanner` agent + prompt + JSON decoder. Conformer's `kind === "planning"` schema-validation path also lives here.

### Slice 4 — scheduler integration

No Slice 1 pre-wiring. Adds auto-dispatch transitions and the per-Phase gate that fires at the post-`phase-planning` version bump.

### Slice 5 — web

Renders Planning Nodes inline; multi-gate approval UX. No Slice 1 pre-wiring beyond the new `OrchestrationEvent` variant flowing through the existing event-stream.

## Open implementation questions

- **Phase-Planner JSON schema.** Needs a tight Effect Schema (input contracts referenced by id, write-set globs, etc.). Can be derived from a subset of the existing Blueprint schema, restricted to "things appendable under a Phase." Defining this schema precisely is Slice 3 work, not design-level.
- **Planning Node worktree base ref.** Phase 2's Planning Node needs to see Phase 1's outputs. Open question whether it sees the integration branch directly or a temporary merge of all Phase 1 verified outputs. Default: integration branch (after Phase 1's merge-back has completed). Revisit if merge-back ordering becomes a v0.2 parallelization concern.
- **Re-plan Phase semantics on a Phase already partly executed.** If a user approves a Phase, some Tasks complete, then they later choose Re-plan Phase via a UI affordance — what's preserved? Out of scope for this design; v0.3 will own the user-initiated replan UX.
