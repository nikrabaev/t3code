# Docs

Agent-facing documentation for the Weave project. Read in order on first visit.

## Index

| File                                           | What's inside                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [concepts.md](concepts.md)                     | The primitives — Vision, Blueprint, Node, Contract, Scope, Verifier, Integration Node, Phase, PendingDecision, Orchestrator. Load this before editing anything.                                                                |
| [architecture.md](architecture.md)             | How the pieces fit. The Weave-over-Superpowers stack, the four validity rules V1–V4, the shared-surface protocol, Node dispatch, Verifier composition, `.weave/` artifact layout, failure modes.                               |
| [t3code-integration.md](t3code-integration.md) | Host-specific plan: how Weave primitives map onto t3code's event-sourced CQRS, the new contracts / server / web files, the Weave-mode UX state machine, what we absorbed from Claude Design and what we held our line against. |
| [v0.1-spec.md](v0.1-spec.md)                   | Concrete build spec for v0.1 sliced four ways (contracts → decider/projector → engine/scheduler/planner → web UI), with the full schema sketches. Direct input for Superpowers `writing-plans`.                                |
| [v0.2-spec.md](v0.2-spec.md)                   | Concrete build spec for v0.2 — parallelization. Four slices (contracts → scope hook → parallel scheduler+merge+subdivide → React Flow canvas). Top of file contains the Q1–Q7 locked decisions.                                |
| [roadmap.md](roadmap.md)                       | Current state and the shipping path from v0.1 (terminal plugin, sequential) to v1.0 (native GUI mode). What we are _not_ building yet.                                                                                         |
| [prior-art.md](prior-art.md)                   | Relationship to [Superpowers](https://github.com/obra/superpowers), which of its skills we reuse versus replace, and the three cultural overrides we own loudly.                                                               |

## Canonical memos

If accessible on the maintainer's machine, the long-form concept memo lives at `~/.claude/plans/ultrathink-i-like-vibe-coding-ethereal-snowglobe.md`. The docs in this directory are distilled from it and are authoritative for day-to-day work.

## Out of scope for docs/

- Product UX wireframes (too early).
- Implementation-level design (pre-code).
- Cost models, pricing, multi-tenant concerns.

When those become relevant, add files — do not bloat the existing docs.
