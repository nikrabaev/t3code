# Weave roadmap

## Current state

**v0.1 in progress.** Slice 1 (contracts extension) merged to `main` as `weave-v0.1-slice-1`. Slice 2 (decider + projector + invariants, pure) queued next.

Per-slice breakdown and definition-of-done for v0.1 live in [v0.1-spec.md](v0.1-spec.md). Architectural decisions locked for v0.2 live at the top of [v0.2-spec.md](v0.2-spec.md).

## Shipping path

Each version delivers something useful on its own and sets up the next.

### v0.1 — direct t3code integration, one Node at a time

A native extension of t3code, not a plugin. New `"weave"` value of `ProviderInteractionMode`, new `WeaveRun` aggregate alongside `Thread`, new `/weave` composer slash command, new full-screen Weave editor surface (left chat sidebar + center canvas + right Node inspector).

Scope:

- **Contracts** — `packages/contracts/src/weave.ts` with all Weave schemas (Blueprint, Node, Contract, Phase, Decision, Run), commands, event payloads. Union-extended into `OrchestrationCommand` / `OrchestrationEvent`.
- **Server** — `WeaveDecider` / `WeaveProjector` / `WeaveEngine` / sequential `WeaveScheduler` / `WeavePlanner` / naive `WeaveContractConformer`. Dispatch per-Node via the existing `ProviderService` → `ClaudeAdapter` path.
- **Web** — `/weave` slash command, `_weave.*` routes, Weave editor component tree, sidebar integration (Weave nested under project with distinct cyan styling).
- **PendingDecisions** — planner emits zero in v0.1; scheduler-gating code exists but dormant.

**Not in v0.1:** parallel dispatch, scope enforcement hooks, Phase gate smoke tests, Redesign mode, DAG graph canvas (list-by-phase instead), React Flow, auto-subdivide.

**Purpose:** prove the DAG + Contract model end-to-end inside t3code on a sequential scheduler. Validates that Weave's primitives fit the host's event-sourced CQRS architecture cleanly. Low risk.

**Status:** Slice 1 of 4 complete.

### v0.2 — parallelization

Concurrent execution of ready siblings with disjoint write-sets, gated by V1 enforcement. Q1–Q7 architectural decisions locked (see top of [v0.2-spec.md](v0.2-spec.md)).

Scope:

- Parallel scheduler — up to `concurrencyCap` concurrent child threads, picked respecting V1.
- `PreToolUse` hook infrastructure — `.claude/settings.local.json` per worktree + local HTTP validator endpoint + scope-violation telemetry.
- `MergeDriver` primitive with one implementation (`package.json` union-merge); lockfile regenerated post-merge by the scheduler.
- Auto-subdivide on Node failure — default policy _"retry once → subdivide once → escalate,"_ depth limit 1, logged to the auto-decision surface.
- React Flow DAG canvas replacing v0.1's list form.
- Live concurrency slider (1–8), Pause control, Blueprint version badge.

**Purpose:** the moment V1–V4 earn their keep. If the rules hold, the hook almost never fires. Hook firings become signals the Blueprint is malformed and should be surfaced for the planner to learn from.

### v0.3 — Phases + PendingDecisions + Redesign + Intervene

The slice that makes Weave genuinely autopilot-grade.

Scope:

- Phase gate modals with smoke-test output + approve / edit-vision / re-plan / abort actions.
- "Chat before deciding" at every gate — casual conversational escape hatch.
- Post-Phase polish as implicit micro-Phase (user-invisible).
- PendingDecision UX — auto-resolver reactor, surface events, pre-authorization DSL (predicate on dimension: library / naming / copy / auth / data / cost), decision-queue sidebar + modal with blast radius.
- Auto-decision log surface.
- **Redesign** composer mode in the Weave sidebar chat — user-initiated Blueprint Amendments with diff overlay on canvas.
- Edit Vision mid-run → global pause + localized replan.
- Node-level pause / resume / restart for user intervene, labeled as _"breaking fresh-context discipline for this Node."_

### v0.4 — polish and observability

Scope:

- Full Blueprint version history + diff viewer (pairs with Redesign).
- **Auto concurrency mode** — slider gains an "Auto" setting that reads rate-limit telemetry and tunes the cap dynamically (TCP-like AIMD, seeded low).
- Cost meter detail + per-Node token charts.
- Observability panel — logs, queue depth, per-worker tokens.
- Fine-grained Bash scope enforcement (v0.2 ships coarse).

### v1.0 — upstream integration

Weave becomes a first-class mode in t3code proper. Depends on pingdotgg opening contributions (currently closed per `CONTRIBUTING.md`) or the maintainers reaching out. In the meantime, v0.4 is fully usable on a local fork — the product does not require upstream adoption to be valuable.

## Explicitly not building yet

Do not touch these unless the user explicitly asks.

- Multi-tenant / RBAC concerns.
- Formal evaluation / benchmark harness.
- Upstream PRs to `pingdotgg/t3code`.
- Alternative host adapters (Codex, Cursor, OpenCode are already wired into t3code's existing `ProviderAdapter`; Weave dispatches through that abstraction, so multi-provider support is latent rather than explicit work).
- Blueprint version restore (viewing old versions is v0.4; actually reverting to one is a separate UX question).

## Open questions resolved during Q1–Q7 (2026-04-21)

From the original concept memo. Captured here as a changelog.

| Question                        | Resolution                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope enforcement mechanism     | Claude Code native `PreToolUse` hook + per-worktree `settings.local.json`; belt-and-suspenders via conservative permission mode (Q1)                                   |
| Concurrent provider sessions    | Each Node = one `claude` CLI subprocess via t3code's `ClaudeAdapter`; concurrency is process-level; rate-limited by user's subscription (Q2)                           |
| Worktree merge-back             | Layer-by-layer merge on the fly into a Run integration branch, deterministic order; merge conflicts = scheduler bug → log and abort (Q3)                               |
| Merge-driver scope              | One `MergeDriver` primitive; `package.json` implementation; lockfile regenerate is a post-merge action; `.gitignore` append-if-missing as a near-future extension (Q4) |
| Concurrency-cap changes mid-run | Cap range [1, 8], default 2; in-flight always finish; Pause is a separate control (Q5)                                                                                 |
| Failure escalation              | Auto-subdivide within pre-authorized policy; depth limit 1; logged to auto-decision surface (Q6)                                                                       |
| PendingDecision gating scaffold | Scheduler gate live in v0.2; auto-resolver + surface + UX all deferred to v0.3 (Q7)                                                                                    |

## Still open

- **Determinism.** Should re-runs of the same Vision produce the same Blueprint? Likely no; the plan-review approval moment makes non-determinism tolerable. Revisit at v0.4 if non-determinism causes friction in practice.
- **`.weave/` artifact durability.** Committed to the repo by default (auditable, noisy) vs. side-channel projection only (clean repo, less forensic). Current default: committed. Revisit if noise becomes a problem.

## Fragile assumptions to mitigate

Named in the concept memo as F1–F3. Each is where v0 tooling must compensate.

- **F1. Hoisting is LLM taste.** The planner is responsible for V3 (Decision closure) and can miss silent semantic conflicts (two siblings pick different state libraries because the ancestor Contract said "use a state library" instead of naming one). _Mitigation:_ planner self-critique pass (v0.3+); project style guide baked into every Blueprint; rejection of under-specified Contracts at compile time.
- **F2. Contracts change under first contact.** Implementation reveals ancestor mistakes. _Mitigation:_ Contract Amendment protocol via Redesign mode (v0.3); localized replan, not full replan; preserve unaffected subtrees.
- **F3. Verifiers are imperfect.** Green does not guarantee correct. _Mitigation:_ keep Phases short; Phase smoke tests run end-to-end (v0.3); humans are the backstop at Phase gates.

When a design decision trades off against one of these, say which one and why.

## Relationship to existing tools

See [prior-art.md](prior-art.md). Tl;dr: Weave sits above Superpowers. It reuses Superpowers' per-feature skills (TDD, worktrees, code review) inside each Node via a Superpowers directive in the dispatch payload, and replaces Superpowers' project-level skills (flat plans, sequential subagent execution) with Weave's DAG-aware parallel-safe scheduler.
