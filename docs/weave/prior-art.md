# Prior art

## Superpowers (the one that matters most)

Repo: **https://github.com/obra/superpowers**. An agentic skills framework and software-development methodology that ships as a plugin for Claude Code, Cursor, Codex, Gemini, OpenCode, and Copilot. Author: Jesse Vincent (obra).

**How Weave relates to it:** Superpowers handles _how to do one feature well._ Weave handles _how to compose many features that work together._ Weave sits **above** Superpowers in the stack (see [architecture.md](architecture.md#the-stack)).

## Reuse as-is (below the Node boundary)

These Superpowers skills run inside each Node. Weave does not touch them.

| Skill                                                         | Role in Weave                                         |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `test-driven-development`                                     | The TDD loop inside each Node                         |
| `using-git-worktrees`                                         | Node isolation — one worktree per sibling             |
| `requesting-code-review` · `receiving-code-review`            | The review stage of the Verifier                      |
| `systematic-debugging`                                        | Used inside failure-retry subagents                   |
| `verification-before-completion`                              | Worker self-check before declaring done               |
| `brainstorming`                                               | Wrapped (and extended with "Defer") by Weave's intake |
| `subagent-driven-development/spec-reviewer-prompt.md`         | Verifier stage 3                                      |
| `subagent-driven-development/code-quality-reviewer-prompt.md` | Verifier stage 6                                      |

## Replace (above the Node boundary)

These Superpowers skills do something analogous to a Weave primitive but in a less capable way. Weave replaces them.

| Superpowers skill                                                                       | What Weave does instead                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `writing-plans` (flat list of tasks with inline code)                                   | `weave:compile-blueprint` — a DAG with Contracts; the Superpowers plan format is retained for _per-Node specs_ only |
| `subagent-driven-development` (sequential)                                              | Weave scheduler (parallel-safe per V1–V4)                                                                           |
| `dispatching-parallel-agents` (scoped to retrospective debugging of unrelated failures) | Generalized to normal execution — the scheduler's default mode                                                      |
| `finishing-a-development-branch`                                                        | Weave's `weave:phase-gate` handles demo checkpoints mid-build, not just at the end                                  |

## Three cultural overrides

Weave overrides three things Superpowers takes as given. Document each **loudly** so downstream contributors don't reimpose them — especially in the Node dispatch preamble and in the plugin README.

### O1. Parallel implementation is permitted

Superpowers explicitly red-flags it (_"Never: Dispatch multiple implementation subagents in parallel (conflicts)."_). Weave permits it **iff V1–V4 hold**. See [architecture.md](architecture.md#validity-rules-v1v4).

Superpowers forbids parallel implementation because it has **no conflict-prevention mechanism**. Weave's Contracts + Scope + V1–V4 are precisely that mechanism. Without V1–V4 rigorously enforced, fall back to sequential execution — the override is not unconditional.

### O2. Plans are interface-first, not recipe-first

Superpowers' `writing-plans` inlines full code — _"show the code."_ Weave's Blueprint inlines **Contracts**; the recipe materializes inside each Node when the Superpowers layer fires. Don't blur the two philosophies at the seam: the Blueprint never contains implementation code; the per-Node spec handed to the worker may.

### O3. Brainstorming allows "Defer"

Superpowers' brainstorming drives toward spec completeness. Weave extends it with a first-class **Defer** option that produces a PendingDecision (see [concepts.md](concepts.md#pendingdecision)). This is a rule-change to the intake skill, not a rejection of it.

## Contribution-policy note

Superpowers' README and `CLAUDE.md` are explicit: _no domain-specific or opinionated skills upstream._ Shipping Weave work as a Superpowers PR is not an option. Ship it as a standalone plugin (see [roadmap.md](roadmap.md#v01--terminal-plugin-sequential)) that _depends on_ Superpowers for the per-Node layer.

## Other prior art (briefer)

| Family                            | Relevance                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Build systems (Bazel, Nix, Make)  | DAGs with hermetic inputs/outputs — the ancestor of Weave's Scope and Blueprint                            |
| CI/CD pipelines                   | Stage gates + approval — the ancestor of Phases                                                            |
| LangGraph · CrewAI · AutoGen      | Multi-agent orchestration; _no_ write-set disjointness or contract-first interface freezing                |
| Tree-of-thought, SWE-agent family | Plan _search_ at reasoning time — Weave is plan _execution_ with replanning on failure, which is different |
| Ralph-wiggum loop                 | The sequential degenerate case — a Blueprint that happens to be linear                                     |

## What is genuinely novel

Honest accounting, from the concept memo:

1. **Ancestor-authored Contracts and conformance tests** — inverts "tests live next to code."
2. **Integration Nodes as a distinct category** from ancestors — ancestors establish interfaces; Integration Nodes stitch concrete fragments.
3. **PendingDecisions as first-class scheduler prerequisites** — the scheduler treats unresolved decisions identically to un-run ancestor Nodes.

Nothing here is a research contribution. It's engineering taste applied to known primitives. The combination, as far as we can tell, is not what LangGraph / CrewAI / AutoGPT / the SWE-agent family give out of the box.
