# Roadmap

## Current state

**Pre-code. Design-only.** This repo contains documentation and no implementation. No language chosen, no dependencies picked, no package layout. When the user says *"start v0.1,"* the first real file to author is the **Blueprint schema** (Markdown-with-sections or YAML-with-Markdown-bodies — decide then).

## Shipping path

Each version delivers something useful on its own and sets up the next.

### v0.1 — terminal plugin, sequential

A Claude Code / Codex plugin that exposes `/weave <goal>`, `/weave-plan`, `/weave-run`.

- Blueprint compiler (produces the DAG + Contracts + Phases + PendingDecisions).
- Single-threaded topo-walk executor (no parallelism yet).
- Each Node dispatches to a Superpowers-empowered worker via the harness's Task/subagent tool.
- PendingDecisions surfaced via plain Q&A.

**Purpose:** prove the DAG + Contract model. Low risk, no concurrency. Shippable in days once scaffolded.

### v0.2 — parallel dispatch

Concurrent subagent calls for ready siblings with disjoint write-sets.

- `PreToolUse` hook enforces Scope (blocks out-of-scope writes at the harness level — outside the LLM).
- Merge-driver for `package.json` appends and other append-only shared files.
- Concurrency cap (configurable, default low).

**Purpose:** this is the moment validity rules V1–V4 earn their keep. If the rules hold, the hook almost never fires. Hook firings are signals the Blueprint is malformed and should be logged for the planner to learn from.

### v0.3 — Phases + PendingDecisions

- Phase gates (can reuse an `ExitPlanMode`-style approval flow).
- Look-ahead surfacing for PendingDecisions (elicit when within *N* Nodes of blocking).
- Pre-authorization predicate DSL for auto-resolution.
- Auto-decision log written to `.weave/decisions/resolved.log.md`.

### v0.4 — GUI sidebar

Live DAG visualization inside the host app.

- Node status colors, live log streams, phase-gate modals, PendingDecision modals.
- Ships either as a plugin UI extension (harness-dependent) or a small companion web app the plugin launches.

### v1.0 — native mode

Weave becomes a first-class mode in Claude Code / Codex alongside Plan mode.

- Depends on Anthropic / OpenAI adopting it.
- By this point v0.4 is validated by real users and the product case writes itself.

## Explicitly not building yet

Do not touch these unless the user explicitly asks.

- Implementation language / framework choice.
- Blueprint schema format (pick in v0.1 scaffolding, not before).
- Specific model routing or cost estimation.
- Multi-tenant / RBAC concerns.
- UX wireframes (written spec only until v0.4).
- Formal evaluation / benchmark harness.

## Open questions (from the design memo)

These will need answers at v0.1 scaffolding time. Flagging them here so agents surface them to the user instead of silently deciding.

- **Concurrency & budgets.** Default concurrency cap? Per-Node token budget? Retry cap before escalation?
- **Plan-review UX.** How does the user edit a Blueprint before execution — tree view, JSON, natural-language patches that re-plan the affected subtree?
- **Determinism.** Should re-runs of the same Vision produce the same Blueprint? Probably not — but the plan-review checkpoint makes non-determinism tolerable.
- **Pre-authorization vocabulary.** How does a user express *"you may pick libraries, you may not pick auth flows"* precisely enough for the Orchestrator to enforce?
- **Artifact durability.** `.weave/` committed to the repo (auditable, noisy) or kept as side-channel metadata (clean repo, less forensic)? Current default: committed. Revisit if noise becomes a problem.
- **Observability.** What does the user see while the autopilot runs — live DAG, log stream, ready queue? Probably all three, but pick a default.

## Fragile assumptions to mitigate

Named in the concept memo as F1–F3. Each one is where v0 tooling must compensate.

- **F1. Hoisting is LLM taste.** The planner is responsible for V3 (Decision closure) and can miss silent semantic conflicts (e.g. two siblings pick different state libraries because the Contract said "use a state library" instead of naming one). *Mitigation:* planner self-critique pass, a project style guide baked into every Blueprint, rejection of under-specified Contracts at compile time.
- **F2. Contracts change under first contact.** Implementation reveals ancestor mistakes. *Mitigation:* cheap Contract Amendment protocol; localized replan, not full replan; preserve unaffected subtrees.
- **F3. Verifiers are imperfect.** Green does not guarantee correct. *Mitigation:* keep Phases short; phase smoke tests run end-to-end; humans are the backstop at gates.

When a design decision trades off against one of these, say which one and why.

## Relationship to existing tools

See [prior-art.md](prior-art.md). Tl;dr: Weave sits above Superpowers, reuses its per-feature skills (TDD, worktrees, review), and replaces its project-level skills (flat plans, sequential subagent execution) with a DAG-aware layer.
