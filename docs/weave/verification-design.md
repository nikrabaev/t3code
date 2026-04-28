# Verification design — making Node Verifiers actually work

Design memo for the verifier subsystem. Not yet a build spec. Read [concepts.md](concepts.md), [architecture.md](architecture.md), and [v0.1-spec.md](v0.1-spec.md) first — this memo assumes that vocabulary and patches the gap between `architecture.md §Verifier composition` (the seven-stage target) and `v0.1-spec.md §3.4` (the one-stage reality).

## Table of contents

- [Problem statement](#problem-statement)
- [What the architecture already says](#what-the-architecture-already-says)
- [Why one shell command can't be the answer](#why-one-shell-command-cant-be-the-answer)
- [Critique of two candidate approaches](#critique-of-two-candidate-approaches)
- [Option set](#option-set)
- [Recommended path](#recommended-path)
- [Open questions](#open-questions)

## Problem statement

v0.1's `WeaveContractConformer` resolves a single shell command (`node.verifierCommand` ?? `project.verifierCommand` ?? `"npm run test"`) and runs it in the Node's worktree. Exit 0 = `verified`, anything else = `failed`. This is brittle in three concrete ways:

1. **Bootstrap problem.** A `scaffold` Node creates the initial repo structure. There is no `package.json` yet, or no `test` script in it, or no test files to run. The default verifier fails on every first Node, regardless of whether the Node did its job correctly.
2. **Self-graded homework.** When the Node *does* have tests, the same agent wrote both the implementation and the tests. Failures are correlated; tests get rewritten until green. `roadmap.md §F3` calls this out explicitly.
3. **Green-but-broken.** Even with tests passing, nothing checks that the Node implemented the *spec* — only that whatever it implemented is internally consistent with whatever it tested.

The user-facing symptom is that the verifier signal is untrustworthy, which means the scheduler's "advance to next Node only on green" guarantee is hollow.

## What the architecture already says

`architecture.md §Verifier composition` specifies a seven-stage layered Verifier:

| # | Stage | Status in v0.1 |
|---|---|---|
| 1 | typecheck | not implemented |
| 2 | build | not implemented |
| 3 | spec-compliance reviewer subagent | not implemented |
| 4 | Contract-conformance tests (ancestor-authored) | not implemented |
| 5 | Node-authored unit tests (TDD loop) | **implemented (the one stage v0.1 ships)** |
| 6 | code-quality reviewer subagent | not implemented |
| 7 | optional judge-LLM | not implemented |

`concepts.md §Contract` defines a Contract as having three parts: (a) syntactic surface, (b) semantic expectations, (c) a conformance test the Verifier can execute. Part (c) is **ancestor-authored** — that's the entire point of the inverted "tests live above code" choice. v0.1 deliberately defers (c) per [v0.1-spec.md §3.4](v0.1-spec.md#34-weavecontractconformer--v01-naive). v0.2 deferred it again in favor of parallelization.

`packages/contracts/src/weave.ts` already declares `WeaveNodeKind` as `"raw" | "scaffold" | "contract" | "utility"`, but nothing branches on it at verification time — the kind is currently a workflow hint with no behavioral consequence.

`roadmap.md` names three fragile assumptions; **F3 ("Verifiers are imperfect")** is precisely this problem. The named mitigations are: short Phases, Phase smoke tests (v0.3), humans at Phase gates.

The architecture already chose the answer. What's missing is implementation.

## Why one shell command can't be the answer

The single-command model bakes three assumptions, all wrong for at least one Node kind:

- **Test infrastructure exists** — false for `scaffold` Nodes by definition.
- **Behavioral correctness implies spec correctness** — false in general; tests can be tautological or miss the actual requirement.
- **The agent that authored the test is independent of the agent that authored the code** — false when the Node writes both.

Different Node kinds need different evidence:

| Kind | Useful evidence |
|---|---|
| `scaffold` | structural: files exist, JSON parses, `bun install` succeeds, expected scripts present |
| `contract` | type-only: `tsc --noEmit` passes; declared exports match the surface; LLM review against spec |
| `utility` | typecheck + tests if a test runner exists |
| `raw` | full stack: structural + typecheck + build + ancestor conformance tests + Node tests + judge-LLM |

The `kind` field is the missing lever.

## Critique of two candidate approaches

Two intuitive proposals, each partially right:

### TDD — make the agent write tests before code

The naive form is flawed because the same agent writes both. Failures correlate; tests get rewritten until green. The variant that works is **ancestor-authored conformance tests**: a *different* agent (the planner authoring the parent's Contract) writes the tests, the descendant Node receives them in its dispatch payload as read-only files, and the verifier runs them.

This is `concepts.md §Contract` part (c). Implementing it properly subsumes "TDD as a Weave practice" without the self-grading flaw.

### Plan exact interfaces and structure, attach to the Node, structural check + AI review

This is essentially Contract part (a) — `surface` — plus a new declarative structural-checks DSL plus stages 3 and 6 of the layered Verifier. Solid direction. The structural-check half is cheap, deterministic, and catches the "agent created a stub instead of a real implementation" failure mode that tests miss. The AI-review half maps onto stages 3 and 6, which the architecture already calls for.

What this approach gets right: the Node's Verifier should have evidence beyond "tests pass." What it misses: the structural shape should come from the **ancestor's Contract**, not from the Node's own self-description, to preserve the failure-isolation property of V4.

## Option set

Ranked by impact-over-effort. Each option is independently shippable.

### 1. Stratify the Verifier by `WeaveNodeKind`

Replace the single `verifierCommand` resolution with a kind-keyed strategy in `WeaveContractConformer`:

- `scaffold` → structural-only. File existence checks, JSON parses, expected `package.json` scripts present, `bun install` succeeds. **No test execution.**
- `contract` → `tsc --noEmit` + declared-exports check + judge-LLM review of surface against spec.
- `utility` → typecheck; tests if a runner is configured.
- `raw` → full stack (compose the other stages).

Smallest viable change. Directly fixes the bootstrap pain. No new schemas required — `kind` already exists on `WeaveNode`.

### 2. Planner-generated per-Node `verify.sh`

`WeavePlanner` emits `.weave/nodes/<id>/verify.sh` at compile time, tailored to the Node's spec and the current state of the repo (does `package.json` exist yet? is there a test runner?). Committed to the audit trail. User can review during the Approve Blueprint gate (which is already a UX moment per `concepts.md §Phase`).

A single static default cannot know whether tests exist yet. The planner does. Push the decision up.

### 3. Materialize ancestor-authored conformance tests (Contract part c)

The Contract-conformance work skipped in v0.2. When the planner authors a Contract, also generate `.weave/contracts/<contract-id>/conformance.test.ts`. The descendant Node receives the test file in its dispatch payload (already specified in `architecture.md §Node dispatch protocol`). The test path lives in the Node's `readSet` but **not** its `writeSet`. Verifier executes it as stage 4.

This is the architectural fix to self-graded homework. Bring it forward.

### 4. Structural-assertions DSL on the Contract

Add to `WeaveContract`:

```ts
structuralChecks: Schema.optional(Schema.Array(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file-exists"),   path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("json-has-path"), file: Schema.String, jsonPath: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("exports"),       file: Schema.String, names: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("imports-from"),  file: Schema.String, module: Schema.String }),
])))
```

Cheap, deterministic, no flaky tests. Catches "agent created stub instead of real impl" and "agent forgot to export a declared symbol." Lives on the Contract — ancestor-authored — to preserve V4.

### 5. Diff-shape preflight

Before any other stage runs, assert:

- Diff is non-empty (catches noops and sandbagging).
- Every changed path matches the Node's `Scope.writeSet` (post-hoc V1 check).
- At least one path in `outputContractIds`'s declared surface is touched.

Almost free. Run for every Node kind. Complementary to v0.2's `PreToolUse` hook (pre-tool gating) — this is post-hoc verification of the same property, which catches hook bypasses or mis-installations.

### 6. Judge-LLM stage with structured output

A subagent with **no shared context** receives: Node spec, input Contracts, the diff (not the full repo), and the agent's final transcript. Returns:

```json
{
  "spec_compliance": "pass" | "fail",
  "concerns": string[],
  "hidden_assumptions": string[]
}
```

Different model is good but not required — fresh context with narrow input is most of the value. Diff-only framing keeps the cost bounded. This is the architecture's stage 7, but mandatory (not optional) for `raw` Nodes.

### 7. Phase-level smoke tests

Already on the v0.3 roadmap. End-to-end script that runs the actual app and pokes at it. Per-Node verification can pass while the integrated Phase is broken; only a Phase-level check catches that. Spec already reserves `.weave/phases/phase-N/smoke-test.sh`.

### Ideas considered and rejected

- **Naive TDD (Node writes tests first).** Self-grading; covered above.
- **Structural checks declared on the Node itself.** Violates V4 (the Node grading its own work). Belongs on the ancestor's Contract.
- **Verifier as a single mega-prompt to a judge LLM.** Loses determinism for stages 1, 2, 4, 5 that don't need an LLM. Use LLMs only where determinism doesn't apply (stages 3, 6, 7).
- **Replay-claims check (parse agent transcript for claims, verify them).** Interesting but high-effort and the diff already tells you what happened. Subsumed by diff-shape preflight + structural checks.

## Recommended path

These compose. A realistic shipping order:

### Phase A — fix the bootstrap pain (one slice)

- **Option 1** (kind-stratified Verifier) + **Option 5** (diff-shape preflight).
- Pure. No new contracts schemas. Branches on the existing `kind` field. Adds a tiny composable stage runner inside `WeaveContractConformer`.
- Eliminates the "verifier fails because there's no `npm test` yet" failure mode.

### Phase B — let the planner own verification (one slice)

- **Option 2** (`verify.sh` per Node) + **Option 4** (structural checks on Contracts).
- Adds one optional field to `WeaveContract` and one optional artifact path. Planner prompt extended.
- Moves the verifier from "static default" to "per-Node, planned alongside the work."

### Phase C — close the self-grading gap (one slice)

- **Option 3** (materialize ancestor-authored conformance tests) + **Option 6** (judge-LLM stage 7).
- This is the v0.2-skipped Contract-conformance work, plus the architecture's stage 7. Completes the inversion principle.

### Phase D — Phase-level backstop (with v0.3 Phase gates)

- **Option 7** (Phase smoke tests).
- Already in the roadmap; mention here for completeness.

Phase A is the only one that's strictly required to unblock current work. Phases B and C are where the verifier becomes genuinely trustworthy.

## Open questions

These should be answered before Phase A lands.

- **Artifact location.** Does `verify.sh` live in `.weave/nodes/<id>/verify.sh` (committed, auditable) or as a transient artifact under `.weave/runs/` (clean repo, less forensic)? Default elsewhere in `.weave/` is "committed" (`architecture.md §weave-artifact-layout`).
- **Structural-check ownership.** On the Contract (ancestor-authored, preserves V4) or on the Node (self-described, simpler schema)? Strong default: **Contract**. The whole inversion principle in `concepts.md §Contract` exists to put expectations above implementation.
- **Judge-LLM independence.** Same model with fresh context, or a deliberately different model? Cost-vs-independence tradeoff. Default: same model, fresh context, diff-only input. Revisit if drift correlates with model identity.
- **Stage failure semantics.** Does any single failing stage fail the Node, or does the Verifier collect all stage outcomes and apply policy? Default: short-circuit on first failure for cheap stages (1, 2, 5), collect for review stages (3, 6, 7).
- **Scaffold "structural checks for the absence of test infrastructure."** What does the planner write into the Contract for a scaffold Node? Probably a fixed template per project type rather than free-form generation, to avoid the planner over-specifying.
- **Node `kind` granularity.** Are four kinds enough? Likely yes for now — the four cover the verification strategies cleanly. Resist adding kinds until a real Node won't fit.

## Relationship to existing roadmap

This memo doesn't propose new features so much as rebalance what ships in which version. Concretely:

- Phase A is **net-new** (could land as v0.1.x or v0.2.x; not currently scoped anywhere).
- Phase B is **net-new** (planner-emitted `verify.sh` is not in any existing spec).
- Phase C is **the Contract-conformance work** that `v0.1-spec.md §3.4` deferred and `v0.2-spec.md` did not pick up. Pulling it forward over additional v0.2 parallelization work is the main scheduling claim of this memo.
- Phase D is **already in the v0.3 plan**.

If accepted, [roadmap.md](roadmap.md) needs a corresponding edit to slot Phases A–C explicitly, and `v0.2-spec.md` should be amended to either include Phase C or to cite this memo as the reason the conformance work moved.
