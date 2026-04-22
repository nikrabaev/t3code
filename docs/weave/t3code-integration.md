# t3code integration

How Weave lands as a mode inside [t3code](https://github.com/pingdotgg/t3code). Read [concepts.md](concepts.md), [architecture.md](architecture.md), and the locked UX decisions in project memory first — this file assumes that vocabulary.

## Context

t3code is a minimal web GUI for coding agents, event-sourced CQRS backend in Effect-TS, React/Vite frontend, WebSocket transport between them. It already has primitives Weave can lean on: threads with per-thread worktrees, checkpointing via git refs, `ProviderInteractionMode` as a first-class concept with values `default` and `plan`, an ordered push bus for domain events, and typed contracts in a schema-only package.

This document maps Weave's primitives onto those, lists the new server/web/contracts files, describes the Weave-mode UX state machine, and records which Claude Design decisions were absorbed and which were overridden.

---

## 1. Host capabilities that shape the integration

| t3code capability | Where | What Weave gets for free |
|---|---|---|
| `ProviderInteractionMode = Schema.Literals(["default", "plan"])` | [`packages/contracts/src/orchestration.ts:93`](../t3code/packages/contracts/src/orchestration.ts) | A first-class extension point. Weave becomes a third value: `"weave"`. |
| Threads with optional `worktreePath` | `packages/contracts/src/orchestration.ts` | Per-Node filesystem isolation. One Node = one child Thread = one worktree. |
| Event-sourced CQRS (Decider / Projector / Reactor / ReceiptBus) | [`apps/server/src/orchestration/`](../t3code/apps/server/src/orchestration) | The exact architecture Weave wants. Blueprint, Node, Contract, PendingDecision, Phase are all aggregates with commands and events. |
| Checkpointing as hidden git refs | `apps/server/src/checkpointing/` | Phase boundaries reuse this directly. A phase ends with a named checkpoint the user can revert to. |
| `turn.plan.updated` runtime events | `packages/contracts/src/providerRuntime.ts` | The infrastructure to stream a structured plan from a provider already exists. Blueprint compilation reuses it. |
| Push channel `orchestration.domainEvent` | `apps/server/src/wsServer/pushBus.ts`, `packages/contracts/src/orchestration.ts` | One ordered, typed pipeline for state updates. Weave events ride it. |
| TanStack Router with layout routes | `apps/web/src/routes/` | Adding a top-level Weave route is structurally clean. |
| Codex-first provider, `claudeCode` reserved in contracts | `packages/contracts/src/provider.ts` | Multi-backend anticipated; Weave dispatches per-Node via the same provider abstraction. |
| Command palette, keybindings, sidebar, branch toolbar — all exist | `apps/web/src/components/` | `/weave` fits the existing command-palette / slash-command idiom. |

The single largest gift: **threads already carry per-thread worktrees**. That reduces Weave's Scope-enforcement problem from "build a sandbox" to "pick a worktree per Node."

---

## 2. Integration thesis

> A **Weave Run** is a parent orchestration aggregate that spawns **child Threads** — one per Node. Weave = the new interaction mode at the Weave Run level; every child Thread runs in `"default"` interaction mode with a Weave-specific dispatch preamble.

Reuse table:

| Weave primitive | t3code native |
|---|---|
| Node | child Thread |
| Node execution | Thread's turn lifecycle (`thread.turn.start` → `turn.quiesced` receipt) |
| Scope (v0.1) | per-Node worktreePath — already enforced by git |
| Verifier stages 3 / 6 | spec-compliance + code-quality reviewer subagents (Superpowers templates inside the child thread) |
| Phase checkpoint | git-checkpoint ref (`CheckpointStore`) |
| Fresh context per Node | `providers.startSession` per child thread |
| Running worker view | `ChatView` drilled-down on child thread |
| Intake conversation | the Weave Run's own sidebar chat (distinct from the parent chat that spawned it) |
| Node intervene (pause/resume) | pause = stop the child thread's turn + freeze its session; resume or restart = new turn with or without prior context |

New additions (no native equivalent):

- **Weave Run** aggregate (parent of child threads, holds Blueprint).
- **Blueprint** schema (DAG + Phases + Contracts + PendingDecisions).
- **WeaveScheduler** reactor (topo walk, readiness, dispatch).
- **WeaveContractConformer** reactor (runs ancestor-authored tests).
- **WeavePhaseGate** reactor (runs smoke test on Phase completion, blocks on approval).
- **WeaveDecisionSurfacer** reactor (look-ahead elicitation).
- **WeavePlanner** layer (Blueprint compiler via a specialized planner turn).
- Web routes `_weave.*` and the full-screen Weave editor surface.

---

## 3. Domain model — contract additions

All under [`packages/contracts/src`](../t3code/packages/contracts/src). Keep the schema-only discipline.

### 3.1 Extend `orchestration.ts`

```ts
// orchestration.ts:93 (existing line)
export const ProviderInteractionMode = Schema.Literals(["default", "plan", "weave"])
```

That's the only change in this file. Every other weave schema lives in a new module.

### 3.2 New file: `packages/contracts/src/weave.ts`

Schema-only, Effect Schema (catalog version already pinned in `package.json`). Full field-level sketch lives in [v0.1-spec.md §Slice 1](v0.1-spec.md#slice-1--contracts-extension). High-level shape:

- **Branded IDs** — `WeaveRunId`, `WeaveNodeId`, `WeaveContractId`, `WeavePhaseId`, `WeaveDecisionId`, `BlueprintVersion`.
- **Enums** — `WeaveRunStatus`, `WeaveNodeStatus`, `WeavePhaseApproval`, `WeaveNodeKind` (`raw | scaffold | contract | utility` — borrowed verbatim from Claude Design's taxonomy).
- **Structs** — `Scope`, `WeaveNode`, `WeaveContract`, `WeavePhase`, `WeaveDecision`, `Blueprint`, `WeaveRun`.
- **Commands** — typed requests to mutate state (full list in §3.3).
- **Domain events** — persisted facts (full list in §3.4).

### 3.3 Commands (namespace: `weave.*`)

Follows the `thread.create` / `thread.turn.start` / `thread.checkpoint.revert` convention (dot segments for hierarchy).

| Command | Purpose |
|---|---|
| `weave.create` | Create a new Weave Run from a parent thread snapshot + goal |
| `weave.blueprint.compile` | Trigger the planner to produce Blueprint v1 (or vN on recompile) |
| `weave.blueprint.approve` | Approve a Blueprint version; unlocks execution |
| `weave.node.ready` | Mark a Node as schedulable (internal; emitted by scheduler) |
| `weave.node.dispatch` | Spawn child thread + worktree + first turn for a Node |
| `weave.node.verified` | Mark a Node complete (Verifier green) |
| `weave.node.failed` | Mark a Node failed after retry/subdivide ladder |
| `weave.node.pause` | Pause a running Node (user-initiated intervention) |
| `weave.node.resume` | Resume a paused Node with accumulated context |
| `weave.node.restart` | Restart a paused Node with fresh context |
| `weave.decision.surface` | Surface a PendingDecision to the user (look-ahead trigger) |
| `weave.decision.resolve` | Record an answer (user or auto) for a PendingDecision |
| `weave.phase.gate` | Emit when all Phase Nodes are verified; triggers smoke test |
| `weave.phase.approve` | Record user approval / rejection / vision-edit of a Phase |
| `weave.amendment.propose` | Redesign mode: propose a Blueprint diff |
| `weave.amendment.apply` | Apply a proposed Amendment; localized replan |
| `weave.exit` | End a Weave Run (user finish or abort) |

### 3.4 Domain events (namespace: `weave.*`, kebab-case within segments)

Follows the `thread.created` / `thread.message-sent` / `thread.turn-diff-completed` convention.

| Event | Fired when |
|---|---|
| `weave.created` | After `weave.create` command passes invariants |
| `weave.blueprint.compiled` | Planner produced a Blueprint (every version) |
| `weave.blueprint.approved` | User approved a version; concurrency cap set |
| `weave.node.dispatched` | Child thread created + first turn started |
| `weave.node.verified` | Node's Verifier went green |
| `weave.node.failed` | Failure ladder exhausted |
| `weave.node.paused` | User-initiated intervene (or auto-pause on global replan) |
| `weave.node.resumed` | Resume with accumulated context |
| `weave.node.restarted` | Restart with fresh context |
| `weave.decision.surfaced` | Look-ahead triggered or user asked to resolve now |
| `weave.decision.resolved` | Answer recorded (user or auto); includes provenance |
| `weave.phase.gated` | All Phase Nodes verified; smoke test ran |
| `weave.phase.approved` | User approved / rejected / edited Vision at gate |
| `weave.amendment.proposed` | Redesign mode produced a draft diff |
| `weave.amendment.applied` | Diff applied; localized replan complete |
| `weave.exited` | Run terminated (finish or abort) |

### 3.5 Push channel extension

Decision: **extend** the existing `orchestration.domainEvent` push channel with a Weave sub-case, rather than create a new channel. Rationale: one ordered pipeline, one discriminated union, matches the existing pattern, and the `wsTransport` / `wsNativeApi` plumbing works unchanged.

Contract change (shape only):

```
OrchestrationDomainEvent = Thread-domain-event | Weave-domain-event
```

Both variants carry `channel: "orchestration.domainEvent"`, distinguished by a top-level discriminant (e.g. `aggregate: "thread" | "weave"`).

---

## 4. Server components

All under [`apps/server/src/orchestration/`](../t3code/apps/server/src/orchestration) unless otherwise noted. Follows existing naming:

| New component | Shape | Mirrors |
|---|---|---|
| `weaveDecider.ts` | Pure `(state, command) => events[]` | `decider.ts` |
| `weaveProjector.ts` | Pure `(state, event) => state` | `projector.ts` |
| `weaveCommandInvariants.ts` | Preconditions, pure | `commandInvariants.ts` |
| `Layers/WeaveEngine.ts` | Service facade, persists events, emits domain events | `OrchestrationEngine.ts` |
| `Layers/WeaveScheduler.ts` | **Key reactor** — walks Blueprint, dispatches Nodes | (new) |
| `Layers/WeaveContractConformer.ts` | On `turn.quiesced`, runs ancestor conformance tests | (new) |
| `Layers/WeavePhaseGate.ts` | On all-Nodes-verified-in-phase, runs smoke test, emits `phase.gated` | (new) |
| `Layers/WeaveDecisionSurfacer.ts` | Monitors DAG look-ahead, emits `decision.surfaced` | (new) |
| `Layers/WeavePlanner.ts` | Compiles a Blueprint via a specialized planner turn | wraps `ProviderService` |

### 4.1 Pure layer

`weaveDecider.ts` takes the current projection of a Weave Run and a command, returns the events to emit (or an `Invariant` error). Examples:

- `weave.blueprint.approve` on a Run whose current blueprint version matches the command → emit `weave.blueprint.approved`.
- `weave.node.verified` when ancestors aren't green → invariant error.
- `weave.amendment.apply` when Run is `running` → emit `weave.amendment.applied` AND pause-all-nodes events for affected subtree.

`weaveProjector.ts` applies events to a read model: `WeaveRunProjection { runMeta, currentBlueprint, nodeStatuses: Map<WeaveNodeId, WeaveNodeStatus>, openDecisions: WeaveDecisionId[], currentPhase, autoDecisionLog }`.

### 4.2 Engine and Scheduler

`WeaveEngine` is the public service, owns the write path. One writer to the Blueprint per Run.

`WeaveScheduler` is a `DrainableWorker`-style reactor that:

1. Subscribes to `weave.blueprint.approved` and `weave.node.verified` events.
2. Computes the ready set: Nodes whose ancestors are all verified AND whose attached PendingDecisions are all resolved.
3. For each ready Node, checks write-set disjointness with currently-running Nodes (for v0.2; v0.1 is sequential so this is trivially true).
4. Issues `weave.node.dispatch` commands up to `concurrencyCap`.
5. On dispatch: creates worktree, issues `thread.create` + `thread.turn.start` to the existing thread system with the Node's payload.
6. Waits on `turn.processing.quiesced` receipt from `RuntimeReceiptBus`.
7. On quiesce → `WeaveContractConformer` runs → emits `weave.node.verified` or `.failed`.
8. Advances.

**v0.1 is sequential.** Only one child thread in flight at a time. V2 lifts the concurrency gate.

### 4.3 Reactors

- **`WeaveContractConformer`** — on `turn.quiesced` for a weave-child thread, reads the Node's ancestor-authored conformance tests, runs them inside the Node's worktree, emits `weave.node.verified` or `.failed`. v0.1 "conformance test" = "npm test passes in that worktree" (naive).
- **`WeavePhaseGate`** — on `weave.node.verified` for the last Node in a Phase, runs the Phase smoke test (if authored), emits `weave.phase.gated` with the outcome.
- **`WeaveDecisionSurfacer`** — on `weave.node.verified`, recomputes look-ahead; if any open PendingDecision is within *N* ready-edges of a Node whose readiness depends on it, emits `weave.decision.surfaced`. v0.1 look-ahead window: 1 (only when a Node is literally next). v0.2: tune.

### 4.4 Planner

`WeavePlanner` wraps `ProviderService` with a specialized system prompt. It runs a single turn whose job is to produce a Blueprint conforming to the contract schema. Returns the Blueprint artifact, emits `weave.blueprint.compiled`.

v0.1: the planner is invoked via `weave.blueprint.compile`. Its output is a Blueprint with at least one Phase and at least one Node, validated against the schema. If validation fails, retry with error in context.

### 4.5 Node dispatch path (the heart)

When `WeaveScheduler` decides a Node is ready:

1. Allocate/reuse worktree via `GitCore.ts` extensions.
2. Compose the Node payload: spec (Markdown), input Contracts (signatures + semantic notes + conformance test file paths), Scope (read-set + write-set), Verifier description, worktree path, **Superpowers directive preamble**.
3. Issue `thread.create` with `interactionMode: "default"`, `worktreePath`, and a `weaveChild: { runId, nodeId }` tag in the metadata.
4. Issue `thread.turn.start` with the Node payload as the user message.
5. Subscribe to receipts.

The **Superpowers directive preamble** (verbatim in the first-turn user message):

> *"Superpowers is loaded. USE: `test-driven-development`, `verification-before-completion`, `systematic-debugging`, `requesting-code-review`. SUPPRESS: `brainstorming`, `writing-plans`, `finishing-a-development-branch`, `subagent-driven-development` — these are handled by Weave at the project layer. You are one Node in a larger plan; do not attempt to re-plan. Your scope is limited to the files listed in writeSet below."*

### 4.6 Scope enforcement

- **v0.1**: worktree boundary = Scope. Enforced by git — the child thread cannot see files outside its worktree. Coarse but safe.
- **v0.2**: PreToolUse hook wrapping `providerManager`. Inspects tool calls before they reach Codex/Claude, rejects writes outside the declared write-set. File-level granularity.

### 4.7 Failure handling

Escalating policy, fixed (not LLM judgment):

1. **Retry with targeted context** — Verifier output diff + failing Contract clause, new turn in the same child thread.
2. **Subdivide** — replan the Node into a micro-DAG, replace it.
3. **Escalate** — mark `failed`, surface to user via `weave.node.failed` event.

v0.1 ships with (1) only, configurable retry count = 1. (2) and (3) come in v0.3.

Contract amendments are handled separately: the child thread's output may include a `needs-amendment` signal, which is caught by `WeaveContractConformer` and converted into a `weave.amendment.propose` command on the ancestor Node.

---

## 5. Web layer

Under [`apps/web/src`](../t3code/apps/web/src).

### 5.1 Routes

Existing: `_chat.$environmentId.$threadId.tsx`.

Add:

- `_weave.$environmentId.$weaveRunId.tsx` — Weave Run top level. Renders Intake, Blueprint-design, or Execution based on projection status.
- `_weave.$environmentId.$weaveRunId.node.$nodeId.tsx` — Drill-down. Node inspector overlaid (or routed) with the child thread's `ChatView`.

### 5.2 Components (new, under `apps/web/src/components/weave/`)

| Component | Responsibility |
|---|---|
| `WeaveView.tsx` | Top-level shell, picks sub-view by projection status |
| `WeaveIntakeView.tsx` | Sidebar chat while Blueprint is null; Q&A UX + Defer affordance |
| `WeaveBlueprintCanvas.tsx` | The center canvas. **v0.1 = grouped-by-Phase list with kind colors**. **v0.2+ = React Flow graph**. Both share the same data contract. |
| `WeaveNodeCard.tsx` | Per-Node card: kind badge, status icon, title, deps chips |
| `WeaveEdgeLayer.tsx` (v0.2+) | SVG bezier edges on the canvas |
| `WeaveExecutionHeader.tsx` | Run title, Blueprint version, counters (done/running/ready/failed/pending), parallelism slider, Run/Pause/Replan |
| `WeaveInspector.tsx` | Right pane. Embeds child-thread `ChatView` for the selected Node |
| `WeaveNodeEditDrawer.tsx` | Edit drawer for Nodes — kind, scope, depends-on, done-when (borrowed from Claude Design Screen 5) |
| `WeavePhaseGateDialog.tsx` | Modal for Phase approval with smoke-test output |
| `WeavePendingDecisionDialog.tsx` | Modal for decision resolution; shows blast radius |
| `WeaveBlueprintDiffOverlay.tsx` | Rendered when Redesign is producing a proposed version |
| `WeaveRedesignComposerButton.tsx` | Replaces the Plan button in the Weave sidebar chat composer |
| `WeaveSummaryView.tsx` | Completion recap |
| `WeaveRunSidebarItem.tsx` | Sidebar representation: cyan stripe, kind glyph, counters, progress bar, expandable children |

### 5.3 Sidebar integration

Weaves are **nested in the project's thread list** (per locked UX decision). Extend [`AppSidebarLayout.tsx`](../t3code/apps/web/src/components/AppSidebarLayout.tsx) / [`Sidebar.tsx`](../t3code/apps/web/src/components/Sidebar.tsx) to render Weave Runs as a distinct row type within the project's children:

- Left cyan-teal accent stripe (the Weave brand color).
- Weave mark glyph (woven threads) instead of the plain status dot.
- Aggregate counters (done / running / failed) and dual-color progress bar (emerald done + cyan running).
- Expandable chevron — reveals child threads (planner entry first, then each Node), indented under a hairline guide, each tagged by kind color.
- Active-state treatment identical to a thread (slight fill) so the mental model carries over.

### 5.4 Composer modes

- **Parent chat** composer: unchanged. Plan mode button stays as it is.
- **Weave sidebar chat** composer: **Redesign replaces Plan.** Button sits in the same slot as Plan, uses a distinct cyan-teal accent, triggers Redesign mode (see [UX memory file](~/.claude/projects/-Users-nikrabaev-Work-personal-ai-deep-plan/memory/project_weave_ux_decisions.md)).

### 5.5 Slash command

`/weave` is a new slash command registered in the composer's command palette infrastructure. Syntax: `/weave` or `/weave <goal text>`.

Behavior:

1. Do not add a turn to the current thread.
2. Snapshot the current thread's history (read-model projection).
3. Issue `weave.create` command with the snapshot and (optional) goal.
4. On `weave.created` event, navigate to `/w/<environmentId>/<weaveRunId>`.
5. Insert a marker anchor in the parent chat at the message position where the command fired. Marker text: `"Weave created → <title> [open]"`. The marker is rendered as a non-message chat-log annotation.

### 5.6 Client state

New stores:

- `weaveStore.ts` — Effect Atom store projection of Weave Runs, subscribed to `orchestration.domainEvent` push.
- `weaveRouteSearch.ts` — route search params for selected Node, Phase filter, design-vs-live toggle.

Existing stores (`store.ts`, `storeSelectors.ts`, `threadSelectionStore.ts`) gain Weave-aware selectors where needed.

---

## 6. Weave mode UX — state machine

```
(entry: /weave)
    │
    ▼
 IntakeAndVision  (sidebar chat; canvas empty)
    │ planner produces Blueprint v1
    ▼
 BlueprintReview  (canvas = design mode; user may edit directly or enter Redesign)
    │ user clicks Approve Blueprint
    ▼
 Executing  (canvas = execution mode; concurrency cap set)
    │
    ├── DecisionSurfaced → PendingDecisionDialog → resolved → Executing
    │
    ├── PhaseGate → PhaseGateDialog → approved → Executing
    │                              ↓ edit-vision → Replanning (global pause) → Executing
    │
    ├── UserRedesign (mid-run) → Replanning (global pause) → AmendmentApplied → Executing
    │
    ▼
 Complete ──▶ ExitWeaveMode (return to parent chat's project view)
```

All transitions are domain events. The web UI is a pure function of the Weave Run projection.

---

## 7. What we absorbed from the Claude Design output

Design bundle reviewed on 2026-04-21. Six screens. We adopted the following:

| From design | Adopted |
|---|---|
| **Kinds taxonomy** — `raw`, `scaffold`, `contract`, `utility` with color coding (blue/teal/purple/amber) | Verbatim. Becomes `WeaveNodeKind`. Visualizes our hoisting rule. |
| **"Extractions" as a user-facing concept** — scaffold/contract/utility extracted up front | Verbatim as product vocabulary. "Hoisting" / "V3" stay as internal terms. |
| **Horizontal layer bands** as DAG layout | Adopted. "Layers" = topological levels, purely visual — NOT the same as Phases. |
| **Plan-ready callout** — 4-stat grid (layers / tasks / extractions / est. wall time with serial comparison) | Adopted. Appears at top of canvas on first Blueprint render. |
| **Parallelism slider as 8 visual lanes** in header | Adopted. |
| **Counters in header** — done / running / ready / failed / pending | Adopted. Ambient state. |
| **Node inspector embedding child-thread chat** | Adopted. Same `ChatView` components. |
| **Node edit drawer with done-when rows** | Adopted. Done-when = visible per-Node Verifier criteria. |
| **Kind-colored dependsOn chips** in edit drawer | Adopted. |
| **Status icon vocabulary** — pending / ready / running / done / blocked / failed / needs-review with pulse for running | Adopted. |
| **Sidebar nesting** — Weaves as a distinct row type within a project's thread list, not in a separate section | **Flipped from earlier decision** in favor of the design. Better t3code conformance. |
| **Failure narrative in Screen 3** (NoteDraft missing from ancestor Contract) | Used as canonical test fixture for Contract Amendment flow. |

---

## 8. Where we held our line against the design

The design was produced without our UX conversation. These choices we did not adopt:

| Design proposed | We kept |
|---|---|
| 3-way composer toggle (Plan / Build / Weave) | `/weave` slash command; no composer mode. Steal the "Weave · helper row" idea for the empty Weave sidebar chat's onboarding. |
| No Weave-level chat; chat only appears per-Node in the inspector | **Full-screen editor with left chat sidebar** — the Weave Run has its own ambient chat throughout design and execution. Supports Redesign mode, mid-run steering, "Chat before deciding" at gates. |
| Planner is its own separate child thread with its own page | Planner intake happens in the Weave's sidebar chat; single unified surface. |
| Canvas is only in execution mode; editing is in a drawer only | Canvas has Design mode and Execution mode via a header toggle; drawer is for local Node edits only. |
| No Phase gates — one Run button from start to finish | **Phase gates are load-bearing.** Smoke test + approval modal between Phases; user can approve / edit Vision / re-plan / abort. |
| No PendingDecisions | **Full PendingDecision mechanics**: Defer in intake, look-ahead surfacing mid-run, pre-authorization DSL, auto-decision log surface. |
| No Redesign mode | **Redesign is the composer mode in the Weave sidebar chat.** Produces Blueprint version (pre-Start) or Contract Amendment (mid-run) as a diff overlay on the canvas. |

---

## 9. Open implementation questions

To resolve at v0.1 scaffolding time, not before. These are tracked for the agent to raise rather than silently decide.

1. **Multiple concurrent Codex sessions.** Does `codex app-server` support N simultaneous sessions (shared app-server process) or do we need N app-server processes? Affects scheduler and `providerManager`.
2. **Planner as a turn vs. a separate service.** Recommend: a specialized turn via `ProviderService` with a system prompt that emits a structured Blueprint. Reuse existing plan-mode infrastructure.
3. **Child-thread visibility default.** Include in normal thread list (noisy but discoverable) or hide by default (clean but requires drilling in via the Weave view)? Recommend hidden with an "Include weave children" toggle.
4. **`.weave/` in-repo artifacts vs. t3code projection only.** Recommend: user-facing artifacts (`vision.md`, `blueprint/current.md`) in-repo; internal Verifier transcripts in projection tables.
5. **Concurrency cap defaults.** Recommend: 2 for v0.2 first ship, user-configurable 1–8.
6. **Pre-authorization DSL.** Recommend: simple predicate on dimension (library / naming / copy / auth / data / cost) rather than free-form prose.
7. **Observability defaults.** Recommend: live DAG + ambient meters + click-to-drill as v0.1-0.4 defaults; logs behind a panel toggle.

---

## 10. Shipping trajectory

See [roadmap.md](roadmap.md) for the v0.1 → v1.0 trajectory. Each slice of v0.1 is detailed in [v0.1-spec.md](v0.1-spec.md).

Ordered build sequence:

1. Slice 1 — contracts extension (schema-only, no runtime).
2. Slice 2 — decider + projector + invariants (pure, testable).
3. Slice 3 — engine + scheduler (sequential) + planner + basic reactors.
4. Slice 4 — web routes + views (intake + list-style Blueprint + inspector).

Order matters: each slice typechecks against the prior. Don't skip ahead.
