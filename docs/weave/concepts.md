# Concepts — the vocabulary

These are the load-bearing names in Weave. Use them verbatim; do not invent synonyms. Every piece of code, doc, schema, and UI element uses this dictionary.

## Quick reference

| Term | One-line gloss |
|---|---|
| **Vision** | user goal + questionnaire answers; immutable within a Phase |
| **Questionnaire** | structured intake that produces the Vision |
| **Blueprint** | the compiled plan — a DAG of Nodes organized into Phases, annotated with Contracts and PendingDecisions |
| **Node** | a unit of work executable in one fresh LLM conversation |
| **Contract** | typed, testable interface a Node exposes to its descendants (author: ancestor, not the Node) |
| **Scope** | a Node's declared read-set + write-set, enforced by the Orchestrator |
| **Verifier** | layered acceptance check (see [architecture.md](architecture.md#verifier-composition)) |
| **Integration Node** | a Node whose Scope is a shared-surface file; runs after its sibling group |
| **Phase** | maximal sub-DAG whose completion produces a user-demonstrable end-state; sync point + approval gate |
| **PendingDecision** | a deferred choice treated as a first-class scheduler prerequisite |
| **Orchestrator** | the runtime that walks the Blueprint, dispatches workers, enforces Scope, runs Verifiers |

## Definitions

### Vision

The user's goal plus questionnaire answers. Deliberately under-specified: captures *what must be true when we're done* and *what the user cares about*, not *how* to get there. The only artifact authored directly by the user. Ground truth for every replan. Immutable except at Phase boundaries.

### Questionnaire

A structured intake that converts a one-line goal into a Vision: scope, non-goals, tech preferences, quality bar, demo cadence, pre-authorization policy for deferred choices. Answers may be **Defer** — producing PendingDecisions. Wraps (and extends) Superpowers' `brainstorming` skill.

### Blueprint

The compiled plan: a DAG of Nodes grouped into Phases, annotated with Contracts and PendingDecisions. **Versioned** — every replanning event yields a new Blueprint with an explicit diff against its predecessor. The only globally shared state. Lives at `.weave/blueprint/current.md` (see [architecture.md](architecture.md#weave-artifact-layout)).

### Node

A unit of work executable in a single fresh LLM conversation. Has: a spec, a Scope (read-set + write-set), input Contracts (from ancestors), output Contracts (to descendants), and a Verifier. **A Node is atomic w.r.t. context** — if it doesn't fit in one fresh conversation, it must be subdivided. It isn't a Node until it does.

### Contract

The typed, testable interface a Node exposes to its descendants. Load-bearing. Three parts:

- **(a) Syntactic surface** — type signatures, schema, route table entry, config-key shape.
- **(b) Semantic expectations** — invariants, error cases, performance envelope, edge cases.
- **(c) A conformance test** the Verifier can execute.

**Contracts are authored by the ancestor, not by the Node they govern.** This inverts the usual "tests live next to code" pattern and is the non-obvious design choice that makes hoisting load-bearing.

### Scope

The read-set and write-set a Node declares up front. Enforced by the Orchestrator via a sandboxed filesystem view (PreToolUse hook at tool-call time). **Write-sets of concurrently-scheduled siblings must be disjoint.** Read-sets may overlap freely.

### Verifier

A layered acceptance check. See [architecture.md](architecture.md#verifier-composition) for the full ordering. A Node is not "done" until the Verifier is green. Green is the only signal the Orchestrator trusts.

### Integration Node

A specialized Node whose Scope is a shared-surface file (top-level router, DI container, OpenAPI document) that sibling fragments must be stitched into. Runs *after* its sibling group. **Distinct from an ancestor:** an ancestor establishes the interface; an Integration Node assembles concrete fragments.

### Phase

A maximal sub-DAG whose completion produces a user-demonstrable end-state — something runnable a human can poke at. **Phases are linear**, not a DAG of phases. Within a Phase: autopilot autonomous. Between Phases: approval gate + the only legitimate moment to edit the Vision.

### PendingDecision

A first-class graph prerequisite: a named deferred choice attached to one or more Nodes. Carries the question, option space, **blast radius** (which subtree depends on the answer), pre-authorization policy, and a resolution record once answered. A Node with unresolved PendingDecisions is not *ready* even if its ancestor Nodes are green. **Decisions and Nodes are both prerequisites; the scheduler doesn't distinguish them.**

### Orchestrator

The stateful process that walks the Blueprint, dispatches workers, enforces Scope, runs Verifiers, and handles failure and replanning. Never writes code itself. Single-writer to the Blueprint; multi-dispatch to workers. The beating heart of Weave mode.

## See also

- [architecture.md](architecture.md) — how these primitives compose.
- [prior-art.md](prior-art.md) — which primitives map to existing Superpowers skills.
