# Architecture

How the Weave primitives compose. Read [concepts.md](concepts.md) first — this file assumes the vocabulary.

## Table of contents

- [The stack](#the-stack)
- [Validity rules V1–V4](#validity-rules-v1v4)
- [The hoisting rule (operational V3)](#the-hoisting-rule)
- [Shared-surface protocol](#shared-surface-protocol)
- [Node dispatch protocol](#node-dispatch-protocol)
- [Verifier composition](#verifier-composition)
- [`.weave/` artifact layout](#weave-artifact-layout)
- [Failure modes](#failure-modes)
- [Weave mode UX (product shape)](#weave-mode-ux-product-shape)

## The stack

```
┌──────────────────────────────────────────────────────────────┐
│  WEAVE MODE  (new — cross-Node orchestration)               │
│  Intake → Blueprint → Scheduler → Phase gates → Exit         │
│                                                              │
│  weave:intake        weave:compile-blueprint                 │
│  weave:author-contract   weave:dispatch (parallel-safe)      │
│  weave:enforce-scope   weave:pending-decision                │
│  weave:verify-contract   weave:phase-gate                    │
└──────────────────────┬───────────────────────────────────────┘
                       │ Node payload: spec + Contracts + Scope
                       │ + Verifier + "Superpowers directive"
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  SUPERPOWERS  (reused — per-Node execution)                  │
│  test-driven-development · using-git-worktrees               │
│  requesting-code-review · receiving-code-review              │
│  systematic-debugging · verification-before-completion       │
│  (subagent-driven-development reviewer templates only)       │
└──────────────────────────────────────────────────────────────┘
```

Two layers, clean seam at the Node boundary. See [prior-art.md](prior-art.md) for the full reuse-vs-replace mapping.

## Validity rules V1–V4

A Blueprint is **valid** iff every concurrently-schedulable set of Nodes satisfies:

**V1. Write-scope disjointness.** Concurrent siblings have pairwise disjoint write-sets. *(File-level guarantee.)*

**V2. Contract sufficiency.** Each Node's input Contracts are sufficient for its spec — no sibling-to-sibling information flow is required. *(Interface-level guarantee.)*

**V3. Decision closure.** Every design choice that could cause semantic conflict between siblings is frozen in a common ancestor's Contract or a resolved PendingDecision. *(Taste-level guarantee.)*

**V4. Verifier independence.** Each Node's Verifier depends only on its own outputs plus ancestor Contracts — never on sibling outputs. *(Failure-localization guarantee.)*

A Blueprint violating any of V1–V4 is malformed. The planner's job is to produce a Blueprint that satisfies all four. These rules are what let Weave override Superpowers' "never parallelize implementation" red flag (see [prior-art.md](prior-art.md#three-cultural-overrides)).

## The hoisting rule

Operational statement of V3: *any concern that appears in the spec of two or more sibling Nodes must be resolved either in a Contract exposed by their nearest common ancestor, or in a PendingDecision whose resolution precedes the sibling fork.*

The planner walks candidate sibling groups and, for each pair, computes the intersection of their implied design space. Non-empty intersection → hoist the concern to the ancestor. The ancestor's spec grows; siblings' specs shrink. Hoisting terminates because every hoist strictly reduces sibling decision scope.

**Known fragile assumption:** "implied design space" is LLM-estimated. The planner's taste is the limit. See [roadmap.md](roadmap.md#fragile-assumptions-to-mitigate) for mitigations.

## Shared-surface protocol

V1 appears to break on files multiple features legitimately touch (`package.json`, `tsconfig.json`, top-level router, DI container, OpenAPI document). Three mechanisms resolve this, picked by file kind:

1. **Hoist.** The ancestor authors the *shape* of the shared surface (router table, DI bindings, schema skeleton). Siblings never edit the shared file; they produce fragments in their own Scope (a route module, a service module, a schema delta).
2. **Stitch.** An Integration Node runs after the sibling group, reads the fragments, and writes the shared file. Its write-set contains the shared file; no sibling's does.
3. **Merge-driver.** For append-only-ish registries (`package.json` dependencies, migration lockfiles): the worker proposes a delta in its own Scope; the Orchestrator merges deterministically **outside the LLM** — conceptually a git merge driver for a known format.

Pick one per file, in that order of preference.

## Node dispatch protocol

Each worker receives a payload containing:

- **Node spec** (short — *what* to build).
- **Input Contracts** — signatures, semantic notes, and the actual conformance test files from each ancestor. The worker can run them locally before declaring done.
- **Scope** — declared read-set + write-set (also hook-enforced at tool-call time).
- **Verifier description** — what must go green, and how to self-check.
- **Worktree assignment** — which branch/directory.
- **Superpowers directive preamble**, verbatim something like:

  > *"Superpowers is loaded. USE: `test-driven-development`, `verification-before-completion`, `systematic-debugging`, `requesting-code-review`. SUPPRESS: `brainstorming`, `writing-plans`, `finishing-a-development-branch`, `subagent-driven-development` — these are handled by Weave at the project layer. You are one Node in a larger plan; do not attempt to re-plan."*

The worker **never** sees the Blueprint, the DAG, sibling specs, or other Nodes' transcripts. From its POV it's a single Superpowers-style session with an unusually well-specified input and a pre-authored test file. Context stays small by construction.

## Verifier composition

Seven stages. Three come from Superpowers (marked **SP**); the rest are Weave or toolchain.

| # | Stage | Source |
|---|---|---|
| 1 | typecheck | language toolchain |
| 2 | build | language toolchain |
| 3 | spec-compliance reviewer subagent | **SP** — `subagent-driven-development/spec-reviewer-prompt.md` |
| 4 | **Contract-conformance tests** | **Weave** — ancestor-authored, executed automatically |
| 5 | Node-authored unit tests (TDD loop) | **SP** — `test-driven-development` |
| 6 | code-quality reviewer subagent | **SP** — `subagent-driven-development/code-quality-reviewer-prompt.md` |
| 7 | optional judge-LLM | Weave (advisory unless the Phase elevates) |

Order matters. Compliance before quality (Superpowers got this right). Contract-conformance slots in right after spec-compliance because Contracts are more stringent (executable) than spec prose — catching failures earlier saves compute.

## `.weave/` artifact layout

Everything except `runs/` is committed. `git log .weave/` is the audit trail.

```
.weave/
├── vision.md                       # user-authored, immutable within a Phase
├── blueprint/
│   ├── v1.md, v2.md, …             # versioned snapshots
│   └── current.md → vN.md
├── contracts/
│   └── <node-id>/
│       ├── contract.md             # shape + semantic notes
│       └── conformance.test.ts     # ancestor-authored
├── decisions/
│   ├── pending.md                  # open questions with blast radii
│   └── resolved.log.md             # user answers + auto-decisions
├── phases/
│   └── phase-N/
│       ├── smoke-test.sh           # authored at compile time
│       └── approval.md             # user sign-off record
└── runs/<node-id>-<timestamp>/     # .gitignore'd Verifier transcripts
```

A reader six months later can reconstruct why every choice was made.

## Failure modes

**Contract proves wrong mid-flight** — three cases:

- *Additive gap* (new field, existing usage still valid): sibling files a Contract Amendment; Orchestrator checks that already-completed siblings aren't invalidated; ancestor is re-opened narrowly to extend the Contract; only consumers re-verified.
- *Breaking gap*: ancestor and descendants invalidated; localized replan from that ancestor down. Completed outputs in unaffected subtrees are preserved.
- *Taste gap* (sibling disagrees but could make it work): default honors the ancestor; surface as a note at phase review.

**Verifier-red Node** — fixed escalating policy (not an LLM judgment call):

1. **Retry with targeted context** — Verifier output diff + failing Contract clause, fresh conversation.
2. **Subdivide** — replan Node into a micro-DAG, replace the original.
3. **Escalate** — mark blocked, surface to the user.

Sample policy: *"retry once, then subdivide once, then escalate."*

**Plan staleness.** When implementation reveals the Blueprint was wrong, trigger **localized replanning**: find the narrowest ancestor whose Contract is now invalid; invalidate its subtree; regenerate from Vision + current repo + new constraint. *The Vision is immutable across replans; the Blueprint is not.* Replanning is a function of Vision + repo, not of the previous Blueprint — we recompute, we don't patch.

**Node doesn't fit in one fresh context.** Pre-flight budget check (spec + Contracts + repo slice + headroom). Overflow → subdivide before dispatch. A Node that cannot fit in a fresh conversation is, by definition, not a Node.

**Green but broken.** Verifiers are imperfect. Typecheck and build are trustworthy; Contract-conformance tests are as good as the ancestor who wrote them; Node-authored unit tests are self-graded homework; the judge-LLM is a stopgap; the phase smoke test is the real backstop. **The system assumes Phases are short enough for a human to catch category-level bugs at boundaries.** A Phase that bundles a month of work is a design smell.

## Weave mode UX (product shape)

Weave is a **mode**, not a command. Same shape as Plan mode but with a bigger state machine.

```
Plan mode:    enter → read-only → ExitPlanMode                → resume
Weave mode:   enter → intake (RO) → Blueprint (RO + edit)
                    → ApproveBlueprint
                    → Execute (tools scoped per-Node)
                    → [Phase gates …]
                    → ExitWeaveMode                           → resume
```

**(a) Intake.** Goal textarea → Q&A panel. Each question has options + **Defer**. Deferred items become a "Decisions Queue" sidebar.

**(b) Blueprint review.** DAG visualization with Phases as horizontal bands and Nodes as cards (scope, contracts, verifier summary). User can edit Contracts (re-plans the subtree), reshape Phase boundaries, prune Nodes. **"Approve Blueprint"** commits `v1.md` and unlocks execution. *This is Plan mode's `ExitPlanMode` moment — the key user-approval gate before code is written.*

**(c) Execution.** DAG animates. Colors: gray (pending) · yellow (running) · green (verified) · red (failed). Side panel: ready queue, concurrency cap, token/cost meter, active workers, recent log lines. Click a Node → live log stream + current Verifier stage.

**(d) PendingDecision modal.** Surfaces when a Decision is within look-ahead of blocking. Shows blast radius ("affects 7 Nodes across Phases 2–3"). User picks or invokes pre-auth auto-resolution.

**(e) Phase gate.** When every Node in a Phase is green: modal shows smoke-test output, auto-decision log since last gate, Blueprint diff. Buttons: **Approve & continue** · **Edit Vision** · **Re-plan Phase** · **Abort**.

**(f) Completion.** Summary: commits/PRs produced, total cost, full auto-decision log, Blueprint version history, per-Phase timings.

See [roadmap.md](roadmap.md) for how this UX arrives incrementally (v0.1 terminal → v0.4 GUI → v1.0 native mode).
