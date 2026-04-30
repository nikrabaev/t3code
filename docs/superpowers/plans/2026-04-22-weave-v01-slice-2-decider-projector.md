# Weave v0.1 — Slice 2 (Decider + Projector + Invariants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Pre-flight HEAD check is mandatory on every task.** See [§"Pre-flight HEAD check protocol"](#pre-flight-head-check-protocol) below — rooted in lessons from Slice 1 ([reference_sdd_git_gotchas.md](~/.claude/projects/-Users-nikrabaev-Work-personal-ai-deep-plan/memory/reference_sdd_git_gotchas.md)).

**Goal:** Add three pure TypeScript files under `apps/server/src/orchestration/` — `weaveProjector.ts`, `weaveDecider.ts`, `weaveCommandInvariants.ts` — that implement the Weave Run state machine as plain functions over the schemas from Slice 1. No IO, no side effects, no integration with the main decider/projector. Output is fully unit-tested in isolation.

**Architecture:** Slice 2 is deliberately pure and **does not replace any apps/server Slice 1 stubs** — those get removed in Slice 3 when the engine, scheduler, and planner wire these pure functions into the real event loop. Slice 2 introduces a new internal projection type `WeaveRunProjection` (per-run; not part of `OrchestrationReadModel`), a projector `(state, event) => state` that evolves it across the 9 weave event types, a command-invariants helper layer, and a decider `(state, command) => events[] | error` that implements the v0.1 decider table from [v0.1-spec.md §2.3](../../weave/v0.1-spec.md#23-decider-cases-v01-subset). Tests follow the existing `apps/server/src/orchestration/*.test.ts` conventions: plain `vitest` (`describe/it/expect`) with `await Effect.runPromise(...)`.

**Tech Stack:** TypeScript, Effect 4 beta (`effect` catalog dep), `@t3tools/contracts` (Slice 1 schemas), `vitest` via `bun run test`, `oxlint` / `oxfmt`.

---

## Context: Slice 1 stubs and Slice 2's non-integration

Slice 1 left six stubs in `apps/server/src` to make `bun typecheck` pass after the contracts extension. Slice 2 is **pure** ([spec §2.7](../../weave/v0.1-spec.md#27-definition-of-done)) and **does not wire anything into the main event loop** — so none of these stubs are removed by Slice 2. They're listed here with their Slice-3 disposition so the plan is explicit.

| Stub                                              | File:line                                                             | Why Slice 2 does NOT touch it                                                                                                                                                                                                                                                                         | When it gets replaced                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Decider exhaustiveness block                      | `apps/server/src/orchestration/decider.ts:744`                        | Removing this requires giving the main decider access to `WeaveRunProjection` state, which means extending `OrchestrationReadModel` (a contracts change). Slice 2 stays pure by keeping the stub and introducing the new decider as a standalone pure function that Slice 3 will call via the engine. | **Slice 3** — `WeaveEngine` composes `decideWeaveCommand` into the command flow. |
| `commandToAggregateRef` weave branch              | `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:66`      | Already correct Slice-1-minimum logic (maps weave commands to `{ aggregateKind: "weave", aggregateId: command.weaveRunId }`). Comment labels it "Slice 1 stub" because the discriminated `(aggregateKind, aggregateId)` correlation type is deferred.                                                 | **Slice 3** — when the correlation type lands.                                   |
| `commandReceiptRepository.upsert` guard           | `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:177,274` | Uses `as ProjectId \| ThreadId` casts because `aggregateId` is a plain union. Correlation-type debt; carry-over #3 keeps this deferred.                                                                                                                                                               | **Slice 3** — new correlation type + DB schema update.                           |
| `"weave" → "default"` interactionMode translation | `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:647`  | Weave runs child threads in `"default"` mode; the outer weave aggregate doesn't produce provider turns. Real wiring requires the scheduler (Slice 3).                                                                                                                                                 | **Slice 3** — `WeaveScheduler` creates child threads explicitly.                 |
| `OrchestrationEventStore.append` die for weave    | `apps/server/src/persistence/Layers/OrchestrationEventStore.ts:185`   | Persistence-layer concern. Slice 2 is pure — no events are persisted here.                                                                                                                                                                                                                            | **Slice 3** — DB schema accepts weave aggregates.                                |
| `"weave" → "default"` Codex mode translation      | `apps/server/src/provider/Layers/CodexSessionRuntime.ts:306`          | Codex API doesn't know about Weave. Translation is permanent architectural behavior, not a stub. The "Slice 1 stub" label on the comment is pessimistic; it may simply stay.                                                                                                                          | **Slice 3** — reassess; likely keep.                                             |

**Carry-over from user:** `(aggregateKind, aggregateId)` correlation debt stays deferred to Slice 3. Slice 2 is pure functions; the current plain-union `aggregateId` is sufficient at that layer — pure functions do not encounter `OrchestrationEvent`'s envelope narrowing because they operate on `WeaveRunProjection`, not `OrchestrationReadModel`.

---

## Pre-flight HEAD check protocol

Root cause of Slice 1's mid-execution divergence: subagent worktree operations sometimes placed new commits on wrong bases, producing a non-linear chain that only surfaced when a test count mismatched expectation. Remediation applied during Slice 1: every implementer subagent's first action is a git-state verification that blocks if the chain is wrong.

**Mandatory protocol for every task's implementer subagent prompt** (must be included verbatim in the Before You Begin section):

```
## Pre-flight HEAD check (MANDATORY — run first, stop on mismatch)

cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git rev-parse HEAD
git branch --show-current            # must be `nikrabaev/weave`
git log --oneline HEAD~3..HEAD

The top three commits MUST match (newest first):
<EXPECTED_SHA_AND_TITLE_1>
<EXPECTED_SHA_AND_TITLE_2>
<EXPECTED_SHA_AND_TITLE_3>

If ANY of these does not match exactly, STOP IMMEDIATELY and report:
"BLOCKED: wrong base — expected top-of-chain <EXPECTED_SHA_1>, got <ACTUAL_SHA>."

Do NOT run git reset, git checkout, git rebase, or any commit-moving command
to try to fix the state — that is the controller's job. Just report and stop.

Also verify the baseline test counts (frozen at Slice 1 close):
cd packages/contracts && bun run test 2>&1 | grep -E "Test Files|Tests" | tail -2
  → expect 8 test files, 129 tests passing.

cd apps/server && bun run test 2>&1 | grep -E "Test Files|Tests" | tail -2
  → capture the baseline on Task 1's first run, then compare every subsequent
    task. Pre-existing GitManager.test.ts failures are environmental (not
    regressions) and should not change in count during Slice 2.

If any baseline moves in an unexpected direction, STOP.
```

The controller fills `<EXPECTED_SHA_AND_TITLE_n>` per task based on the plan's task sequence. Every implementer also reports its starting SHA and final SHA on completion, so the controller can reconstruct the chain cheaply if anything slips.

**Red-flag pattern for controller:** if a subagent's reported test count doesn't match the controller's expectation, **treat it as a chain-integrity signal, not a test-flakiness signal** ([reference_sdd_git_gotchas.md](~/.claude/projects/-Users-nikrabaev-Work-personal-ai-deep-plan/memory/reference_sdd_git_gotchas.md)).

---

## Branch setup (already in place — read-only verification)

Slice 2 executes on `nikrabaev/weave`, the single canonical branch for all Weave work. `main` tracks `origin/main` (upstream t3code) and is NOT touched by Slice 2. The plan document that defines this slice is already committed on the branch (at or near HEAD — the branch may have a few housekeeping commits on top refreshing paths), so Task 1 begins directly on top of whatever the branch tip is when execution starts.

Verify before starting Task 1:

```bash
cd /Users/nikrabaev/Work/personal/ai-deep-plan/t3code
git branch --show-current               # must be `nikrabaev/weave`
git log --oneline HEAD~4..HEAD          # recent commits; top is the current branch tip
git log --oneline HEAD~4..HEAD | grep -q "Weave v0.1 Slice 2" \
  && echo "Slice 2 plan committed ✓" \
  || echo "Slice 2 plan NOT in recent history — STOP"
git tag --list weave-v0.1-slice-1       # must show the tag (sanity: Slice 1 close intact)
git merge-base --is-ancestor weave-v0.1-slice-1 HEAD \
  && echo "Slice 1 close reachable ✓" \
  || echo "Slice 1 tag orphaned — controller must retag before proceeding"
```

If `nikrabaev/weave` is NOT checked out, stop — the controller needs to switch branches before proceeding. Do not create a new branch.

At Slice 2 close, tag the final commit `weave-v0.1-slice-2` on `nikrabaev/weave`. No merge to main — the branch is self-contained. (Mirrors the Slice 1 close tag pattern; differs only in that Slice 1 also performed a `--no-ff` merge to `main`, which is obsolete now that Weave work is segregated.)

---

## File structure

| File                                                           | Change  | Responsibility                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration/weaveProjector.ts`              | **NEW** | Defines `WeaveRunProjection` type, `createEmptyWeaveProjection(run: WeaveRun)`, `projectWeaveEvent(state \| null, event) => state`. Pure.                                                                       |
| `apps/server/src/orchestration/weaveProjector.test.ts`         | **NEW** | Per-event test cases (9 events × happy-path + idempotency check).                                                                                                                                               |
| `apps/server/src/orchestration/weaveCommandInvariants.ts`      | **NEW** | Pure helper functions: `requireRunAbsent`, `requireRun`, `requireRunNotTerminal`, `requireStatus`, `requireNode`, `requireNodeStatus`, `requireBlueprintVersion`, `requireOpenDecision`, `requirePhasePending`. |
| `apps/server/src/orchestration/weaveCommandInvariants.test.ts` | **NEW** | Per-helper test cases.                                                                                                                                                                                          |
| `apps/server/src/orchestration/weaveDecider.ts`                | **NEW** | `decideWeaveCommand({ projection, command })` — switch on command type, calls invariants, emits `PlannedWeaveEvent[]`.                                                                                          |
| `apps/server/src/orchestration/weaveDecider.test.ts`           | **NEW** | Per-command cases: happy path + ≥1 invariant violation per command.                                                                                                                                             |

**No existing files are modified** in Slice 2. `decider.ts`, `projector.ts`, `commandInvariants.ts`, and all layers under `Layers/` remain unchanged. This is the spec-mandated scope ([spec §2.1](../../weave/v0.1-spec.md#21-files)).

### Key type shapes

**`WeaveRunProjection`** (not in contracts — server-internal):

```ts
export type WeaveRunProjection = {
  readonly run: WeaveRun;
  readonly currentBlueprint: Blueprint | null;
  readonly nodeStatuses: ReadonlyMap<WeaveNodeId, WeaveNodeStatus>;
  readonly openDecisions: ReadonlySet<WeaveDecisionId>;
  readonly autoDecisionLog: ReadonlyArray<{
    readonly decisionId: WeaveDecisionId;
    readonly answer: string;
    readonly at: IsoDateTime;
  }>;
  readonly phaseApprovals: ReadonlyMap<WeavePhaseId, WeavePhaseApproval>;
  readonly childThreads: ReadonlyMap<
    WeaveNodeId,
    {
      readonly threadId: ThreadId;
      readonly worktreePath: string;
    }
  >;
};
```

**`PlannedWeaveEvent`** (the decider's output element shape — weave variant of `OrchestrationEvent` without `sequence`):

```ts
// Narrow to the weave variants, drop `sequence` (the engine assigns it).
export type PlannedWeaveEvent = Omit<
  Extract<OrchestrationEvent, { readonly aggregateKind: "weave" }>,
  "sequence"
>;
```

**`WeaveProjectorError`** and **`WeaveDeciderError`** — reuse the existing `OrchestrationProjectorDecodeError` and `OrchestrationCommandInvariantError` from `apps/server/src/orchestration/Errors.ts` (no new error types in Slice 2).

### Relationship between state types

Slice 2 operates on `WeaveRunProjection` (one per Weave Run, keyed by `WeaveRunId`). Slice 3 will expose a container store (e.g. `WeaveProjectionStore = ReadonlyMap<WeaveRunId, WeaveRunProjection>`) and wire it into the engine. For Slice 2, each projector/decider call takes a single run's projection (or `null` for creation).

---

## Task 1: Infrastructure — types, fixtures, invariants helpers, test scaffolding

**Files:**

- Create: `apps/server/src/orchestration/weaveProjector.ts` (skeleton — type + factory only, no event cases yet)
- Create: `apps/server/src/orchestration/weaveCommandInvariants.ts` (all helper functions; fully implemented in this task since they're consumed by every subsequent decider task)
- Create: `apps/server/src/orchestration/weaveCommandInvariants.test.ts` (all helper tests)

**Pre-flight HEAD expectation:** top of chain is the plan-doc commit (prep step from "Branch setup" above).

- [ ] **Step 1.1: Create `weaveProjector.ts` skeleton**

Only the type, the empty-projection factory, and a `projectWeaveEvent` dispatcher stub that no-ops for every event type. Per-event logic comes in Tasks 2–5. Full content:

```ts
import type {
  Blueprint,
  IsoDateTime,
  OrchestrationEvent,
  ThreadId,
  WeaveDecisionId,
  WeaveNodeId,
  WeaveNodeStatus,
  WeavePhaseApproval,
  WeavePhaseId,
  WeaveRun,
} from "@t3tools/contracts";
import { Effect } from "effect";

import type { OrchestrationProjectorDecodeError } from "./Errors.ts";

// A WeaveRunProjection is the state accumulated for one Weave Run by replaying
// that run's events. It is server-internal (not part of OrchestrationReadModel).
// Slice 3 will own a container store keyed by WeaveRunId.
export type WeaveRunProjection = {
  readonly run: WeaveRun;
  readonly currentBlueprint: Blueprint | null;
  readonly nodeStatuses: ReadonlyMap<WeaveNodeId, WeaveNodeStatus>;
  readonly openDecisions: ReadonlySet<WeaveDecisionId>;
  readonly autoDecisionLog: ReadonlyArray<{
    readonly decisionId: WeaveDecisionId;
    readonly answer: string;
    readonly at: IsoDateTime;
  }>;
  readonly phaseApprovals: ReadonlyMap<WeavePhaseId, WeavePhaseApproval>;
  readonly childThreads: ReadonlyMap<
    WeaveNodeId,
    {
      readonly threadId: ThreadId;
      readonly worktreePath: string;
    }
  >;
};

// Narrowed weave-only event variants (no sequence field; projector takes a
// fully-envelope'd event since it may need eventId / aggregateId / metadata).
export type WeaveOrchestrationEvent = Extract<
  OrchestrationEvent,
  { readonly aggregateKind: "weave" }
>;

// Factory for an empty projection from a newly-created WeaveRun.
// Used by the `weave.created` case and by test fixtures.
export function createEmptyWeaveProjection(run: WeaveRun): WeaveRunProjection {
  return {
    run,
    currentBlueprint: null,
    nodeStatuses: new Map(),
    openDecisions: new Set(),
    autoDecisionLog: [],
    phaseApprovals: new Map(),
    childThreads: new Map(),
  };
}

// Main projector entry. Accepts `null` for the pre-creation state (so
// `weave.created` can materialize the projection). All other events require
// a non-null projection and return an error if passed null.
//
// Per-event logic is added incrementally in Tasks 2–5. Until then every
// branch falls through to the "no projection" error for null input and
// returns the projection unchanged for all event types.
export function projectWeaveEvent(
  state: WeaveRunProjection | null,
  event: WeaveOrchestrationEvent,
): Effect.Effect<WeaveRunProjection, OrchestrationProjectorDecodeError> {
  // Populated in Tasks 2–5. For now, every event type is a no-op modulo null.
  if (state === null) {
    return Effect.fail({
      _tag: "OrchestrationProjectorDecodeError",
      eventType: event.type,
      issue: `weave event ${event.type} requires a pre-existing projection (null received)`,
    } as OrchestrationProjectorDecodeError);
  }
  return Effect.succeed(state);
}
```

Note: the `Effect.fail(...)` literal here is a placeholder. Task 2 replaces the body with real per-event logic, and the null-check becomes specific to cases that require pre-existing state. Task 2 will also replace the placeholder `OrchestrationProjectorDecodeError` construction with proper constructor calls — keeping this skeleton minimal so the file compiles for Task 1's test infrastructure.

- [ ] **Step 1.2: Create `weaveCommandInvariants.ts` with the full helper set**

Full content:

```ts
import type {
  BlueprintVersion,
  WeaveCommand,
  WeaveDecisionId,
  WeaveNode,
  WeaveNodeId,
  WeaveNodeStatus,
  WeavePhaseId,
  WeaveRunStatus,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import type { WeaveRunProjection } from "./weaveProjector.ts";

function fail(command: WeaveCommand, detail: string) {
  return Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail,
    }),
  );
}

// Run existence

export function requireRunAbsent(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.projection === null) return Effect.void;
  return fail(
    input.command,
    `weave run '${input.projection.run.id}' already exists and cannot be created twice.`,
  );
}

export function requireRun(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<WeaveRunProjection, OrchestrationCommandInvariantError> {
  if (input.projection !== null) return Effect.succeed(input.projection);
  return fail(input.command, `weave run does not exist for command '${input.command.type}'.`);
}

export function requireStatus(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly allowed: ReadonlyArray<WeaveRunStatus>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.allowed.includes(input.projection.run.status)) return Effect.void;
  return fail(
    input.command,
    `weave run status is '${input.projection.run.status}'; expected one of [${input.allowed.join(", ")}].`,
  );
}

export function requireRunNotTerminal(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const s = input.projection.run.status;
  if (s === "complete" || s === "aborted") {
    return fail(input.command, `weave run already terminated (status='${s}').`);
  }
  return Effect.void;
}

// Blueprint

export function requireBlueprintVersion(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly version: BlueprintVersion;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.projection.run.currentBlueprintVersion === input.version) return Effect.void;
  return fail(
    input.command,
    `blueprint version mismatch: run has '${input.projection.run.currentBlueprintVersion ?? "none"}', command references '${input.version}'.`,
  );
}

// Node

export function requireNode(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly nodeId: WeaveNodeId;
}): Effect.Effect<WeaveNode, OrchestrationCommandInvariantError> {
  const bp = input.projection.currentBlueprint;
  if (bp === null) {
    return fail(input.command, `weave run has no current blueprint; no nodes to address.`);
  }
  const node = bp.nodes.find((n) => n.id === input.nodeId);
  if (node !== undefined) return Effect.succeed(node);
  return fail(
    input.command,
    `node '${input.nodeId}' not found in current blueprint (v${bp.version}).`,
  );
}

export function requireNodeStatus(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly nodeId: WeaveNodeId;
  readonly allowed: ReadonlyArray<WeaveNodeStatus>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const actual = input.projection.nodeStatuses.get(input.nodeId);
  if (actual !== undefined && input.allowed.includes(actual)) return Effect.void;
  return fail(
    input.command,
    `node '${input.nodeId}' status is '${actual ?? "unknown"}'; expected one of [${input.allowed.join(", ")}].`,
  );
}

// Decision

export function requireOpenDecision(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly decisionId: WeaveDecisionId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.projection.openDecisions.has(input.decisionId)) return Effect.void;
  return fail(
    input.command,
    `decision '${input.decisionId}' is not open (either unknown or already resolved).`,
  );
}

// Phase

export function requirePhasePending(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly phaseId: WeavePhaseId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const approval = input.projection.phaseApprovals.get(input.phaseId) ?? "pending";
  if (approval === "pending") return Effect.void;
  return fail(
    input.command,
    `phase '${input.phaseId}' has approval '${approval}'; expected 'pending'.`,
  );
}
```

- [ ] **Step 1.3: Write invariant-helper tests (failing before step 1.2, but 1.2 already lands the helpers — this ordering works because the helpers are self-contained functions)**

Create `apps/server/src/orchestration/weaveCommandInvariants.test.ts`. Shared fixtures use `ProjectId.make(...)`, `WeaveRunId.make(...)`, etc. Cover:

```ts
import {
  BlueprintVersion,
  CommandId,
  ProjectId,
  WeaveCommand,
  WeaveDecisionId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  requireBlueprintVersion,
  requireNode,
  requireNodeStatus,
  requireOpenDecision,
  requirePhasePending,
  requireRun,
  requireRunAbsent,
  requireRunNotTerminal,
  requireStatus,
} from "./weaveCommandInvariants.ts";
import { createEmptyWeaveProjection, type WeaveRunProjection } from "./weaveProjector.ts";

const now = new Date().toISOString();

const sampleCommand: WeaveCommand = {
  type: "weave.create",
  commandId: CommandId.make("cmd-1"),
  weaveRunId: WeaveRunId.make("run-1"),
  projectId: ProjectId.make("project-1"),
  title: "X",
  vision: "",
  createdAt: now,
};

const emptyProjection = (): WeaveRunProjection =>
  createEmptyWeaveProjection({
    id: WeaveRunId.make("run-1"),
    projectId: ProjectId.make("project-1"),
    title: "X",
    vision: "",
    status: "draft",
    concurrencyCap: 1,
    createdAt: now,
  });

describe("weaveCommandInvariants", () => {
  it("requireRunAbsent: passes when projection is null", async () => {
    await Effect.runPromise(requireRunAbsent({ projection: null, command: sampleCommand }));
  });

  it("requireRunAbsent: rejects when a projection already exists", async () => {
    await expect(
      Effect.runPromise(
        requireRunAbsent({ projection: emptyProjection(), command: sampleCommand }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("requireRun: returns the projection when present", async () => {
    const p = await Effect.runPromise(
      requireRun({ projection: emptyProjection(), command: sampleCommand }),
    );
    expect(p.run.id).toBe(WeaveRunId.make("run-1"));
  });

  it("requireRun: rejects when null", async () => {
    await expect(
      Effect.runPromise(requireRun({ projection: null, command: sampleCommand })),
    ).rejects.toThrow("does not exist");
  });

  it("requireStatus: passes when in allowed list", async () => {
    await Effect.runPromise(
      requireStatus({
        projection: emptyProjection(),
        command: sampleCommand,
        allowed: ["draft", "reviewing"],
      }),
    );
  });

  it("requireStatus: rejects when not in allowed list", async () => {
    await expect(
      Effect.runPromise(
        requireStatus({
          projection: emptyProjection(),
          command: sampleCommand,
          allowed: ["running"],
        }),
      ),
    ).rejects.toThrow("expected one of [running]");
  });

  it("requireRunNotTerminal: passes for draft / reviewing / running / paused", async () => {
    for (const s of ["draft", "reviewing", "running", "paused"] as const) {
      const p = { ...emptyProjection(), run: { ...emptyProjection().run, status: s } };
      await Effect.runPromise(requireRunNotTerminal({ projection: p, command: sampleCommand }));
    }
  });

  it("requireRunNotTerminal: rejects complete and aborted", async () => {
    for (const s of ["complete", "aborted"] as const) {
      const p = { ...emptyProjection(), run: { ...emptyProjection().run, status: s } };
      await expect(
        Effect.runPromise(requireRunNotTerminal({ projection: p, command: sampleCommand })),
      ).rejects.toThrow("already terminated");
    }
  });

  it("requireBlueprintVersion: passes on exact match", async () => {
    const p = {
      ...emptyProjection(),
      run: { ...emptyProjection().run, currentBlueprintVersion: BlueprintVersion.make(2) },
    };
    await Effect.runPromise(
      requireBlueprintVersion({
        projection: p,
        command: sampleCommand,
        version: BlueprintVersion.make(2),
      }),
    );
  });

  it("requireBlueprintVersion: rejects on mismatch", async () => {
    const p = {
      ...emptyProjection(),
      run: { ...emptyProjection().run, currentBlueprintVersion: BlueprintVersion.make(2) },
    };
    await expect(
      Effect.runPromise(
        requireBlueprintVersion({
          projection: p,
          command: sampleCommand,
          version: BlueprintVersion.make(3),
        }),
      ),
    ).rejects.toThrow("blueprint version mismatch");
  });

  it("requireNode: rejects when blueprint is null", async () => {
    await expect(
      Effect.runPromise(
        requireNode({
          projection: emptyProjection(),
          command: sampleCommand,
          nodeId: WeaveNodeId.make("node-1"),
        }),
      ),
    ).rejects.toThrow("no current blueprint");
  });

  it("requireNodeStatus: rejects unknown node", async () => {
    await expect(
      Effect.runPromise(
        requireNodeStatus({
          projection: emptyProjection(),
          command: sampleCommand,
          nodeId: WeaveNodeId.make("node-x"),
          allowed: ["running"],
        }),
      ),
    ).rejects.toThrow("status is 'unknown'");
  });

  it("requireOpenDecision: passes when in openDecisions set", async () => {
    const p = {
      ...emptyProjection(),
      openDecisions: new Set([WeaveDecisionId.make("decision-1")]),
    };
    await Effect.runPromise(
      requireOpenDecision({
        projection: p,
        command: sampleCommand,
        decisionId: WeaveDecisionId.make("decision-1"),
      }),
    );
  });

  it("requireOpenDecision: rejects when not in openDecisions", async () => {
    await expect(
      Effect.runPromise(
        requireOpenDecision({
          projection: emptyProjection(),
          command: sampleCommand,
          decisionId: WeaveDecisionId.make("decision-z"),
        }),
      ),
    ).rejects.toThrow("is not open");
  });

  it("requirePhasePending: passes when phase absent from approvals map (default pending)", async () => {
    await Effect.runPromise(
      requirePhasePending({
        projection: emptyProjection(),
        command: sampleCommand,
        phaseId: WeavePhaseId.make("phase-1"),
      }),
    );
  });

  it("requirePhasePending: rejects when phase approved", async () => {
    const p = {
      ...emptyProjection(),
      phaseApprovals: new Map([[WeavePhaseId.make("phase-1"), "approved" as const]]),
    };
    await expect(
      Effect.runPromise(
        requirePhasePending({
          projection: p,
          command: sampleCommand,
          phaseId: WeavePhaseId.make("phase-1"),
        }),
      ),
    ).rejects.toThrow("expected 'pending'");
  });
});
```

- [ ] **Step 1.4: Run the tests**

From the repo root: `cd apps/server && bun run test -- --run src/orchestration/weaveCommandInvariants.test.ts`

Expected: all ~15 invariant-helper tests pass. If any fail, the helper implementations in step 1.2 don't match the tests — fix them before proceeding.

- [ ] **Step 1.5: Typecheck**

Run: `cd apps/server && bun typecheck`

Expected: clean.

- [ ] **Step 1.6: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts \
        apps/server/src/orchestration/weaveCommandInvariants.ts \
        apps/server/src/orchestration/weaveCommandInvariants.test.ts
git commit -m "feat(server): add WeaveRunProjection type and weave invariant helpers"
```

---

## Task 2: Projector case — `weave.created`

**Files:**

- Modify: `apps/server/src/orchestration/weaveProjector.ts`
- Create: `apps/server/src/orchestration/weaveProjector.test.ts`

**Pre-flight HEAD expectation:** top of chain is Task 1's commit.

Logic: `weave.created` materializes a new `WeaveRunProjection` via `createEmptyWeaveProjection`, populated from the event payload. The `run.status` is set to `"draft"` (matches the event's creation semantics). The input `state` MUST be `null` (the run doesn't exist yet); if non-null, return a decode error.

- [ ] **Step 2.1: Write the failing test**

Create `apps/server/src/orchestration/weaveProjector.test.ts`:

```ts
import { CommandId, EventId, OrchestrationEvent, ProjectId, WeaveRunId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { projectWeaveEvent, type WeaveOrchestrationEvent } from "./weaveProjector.ts";

const now = new Date().toISOString();

// Helper: build a minimally-valid weave-aggregate event envelope.
function weaveEvent<T extends WeaveOrchestrationEvent["type"]>(
  type: T,
  payload: Extract<WeaveOrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<WeaveOrchestrationEvent> = {},
): Extract<WeaveOrchestrationEvent, { type: T }> {
  return {
    sequence: 1,
    eventId: EventId.make("event-" + type),
    aggregateKind: "weave",
    aggregateId: WeaveRunId.make("run-1"),
    type,
    occurredAt: now,
    commandId: CommandId.make("cmd-" + type),
    causationEventId: null,
    correlationId: CommandId.make("cmd-" + type),
    metadata: {},
    payload,
    ...overrides,
  } as Extract<WeaveOrchestrationEvent, { type: T }>;
}

describe("projectWeaveEvent — weave.created", () => {
  it("materializes a new projection with status=draft and concurrencyCap=1", async () => {
    const event = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "Test Run",
      vision: "# Goal",
      occurredAt: now,
    });

    const result = await Effect.runPromise(projectWeaveEvent(null, event));

    expect(result.run.id).toBe(WeaveRunId.make("run-1"));
    expect(result.run.title).toBe("Test Run");
    expect(result.run.status).toBe("draft");
    expect(result.run.concurrencyCap).toBe(1);
    expect(result.currentBlueprint).toBeNull();
    expect(result.nodeStatuses.size).toBe(0);
    expect(result.openDecisions.size).toBe(0);
    expect(result.autoDecisionLog.length).toBe(0);
    expect(result.phaseApprovals.size).toBe(0);
    expect(result.childThreads.size).toBe(0);
  });

  it("propagates optional parent-thread / parent-message / snapshot-content fields", async () => {
    const event = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-2"),
      projectId: ProjectId.make("project-1"),
      title: "With Parent",
      vision: "",
      parentThreadId: undefined, // optional
      occurredAt: now,
    });
    // Re-create with fields populated explicitly to test they flow through:
    const populated = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-3"),
      projectId: ProjectId.make("project-1"),
      title: "Full",
      vision: "",
      parentThreadId: "thread-parent" as never,
      parentMessageId: "msg-parent" as never,
      snapshotContent: "# parent chat",
      occurredAt: now,
    });

    const result = await Effect.runPromise(projectWeaveEvent(null, populated));
    expect(result.run.parentThreadId).toBe("thread-parent");
    expect(result.run.parentMessageId).toBe("msg-parent");
    expect(result.run.snapshotContent).toBe("# parent chat");
  });

  it("rejects when projection is non-null (run already exists)", async () => {
    const event = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "dup",
      vision: "",
      occurredAt: now,
    });
    const existing = await Effect.runPromise(projectWeaveEvent(null, event));
    await expect(Effect.runPromise(projectWeaveEvent(existing, event))).rejects.toThrow(
      "already exists",
    );
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: FAIL. The skeleton's `projectWeaveEvent` returns the input unchanged for non-null state; for null state it returns an error whose message doesn't match the new test's expectation.

- [ ] **Step 2.3: Implement the `weave.created` case**

Replace the body of `projectWeaveEvent` in `weaveProjector.ts` with a switch on `event.type`. Full replacement (this supersedes the Task 1 skeleton body):

```ts
export function projectWeaveEvent(
  state: WeaveRunProjection | null,
  event: WeaveOrchestrationEvent,
): Effect.Effect<WeaveRunProjection, OrchestrationProjectorDecodeError> {
  switch (event.type) {
    case "weave.created": {
      if (state !== null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave run '${state.run.id}' already exists — weave.created requires null state.`,
          }),
        );
      }
      const { payload } = event;
      return Effect.succeed(
        createEmptyWeaveProjection({
          id: payload.weaveRunId,
          projectId: payload.projectId,
          title: payload.title,
          vision: payload.vision,
          parentThreadId: payload.parentThreadId,
          parentMessageId: payload.parentMessageId,
          snapshotContent: payload.snapshotContent,
          status: "draft",
          concurrencyCap: 1,
          createdAt: payload.occurredAt,
        }),
      );
    }
    default: {
      // Placeholder: Tasks 3–5 add the remaining 8 event cases.
      if (state === null) {
        return Effect.fail(
          new OrchestrationProjectorDecodeError({
            eventType: event.type,
            issue: `weave event ${event.type} requires a pre-existing projection (null received)`,
          }),
        );
      }
      return Effect.succeed(state);
    }
  }
}
```

Add the `OrchestrationProjectorDecodeError` import at the top of the file:

```ts
import { OrchestrationProjectorDecodeError } from "./Errors.ts";
```

(Replace the existing `import type { OrchestrationProjectorDecodeError }` — we need the value now.)

- [ ] **Step 2.4: Run the tests to verify they pass**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: all 3 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts \
        apps/server/src/orchestration/weaveProjector.test.ts
git commit -m "feat(server): project weave.created into a new WeaveRunProjection"
```

---

## Task 3: Projector cases — `weave.blueprint-compiled` and `weave.blueprint-approved`

**Files:**

- Modify: `apps/server/src/orchestration/weaveProjector.ts`
- Modify: `apps/server/src/orchestration/weaveProjector.test.ts`

**Pre-flight HEAD expectation:** top three commits should be Task 2 → Task 1 → plan-doc.

Logic:

- `weave.blueprint-compiled`: sets `currentBlueprint`, transitions `run.status` to `"reviewing"`, hydrates `nodeStatuses` (every blueprint node starts `"pending"`), seeds `openDecisions` from `blueprint.decisions` (all unresolved ones — in v0.1 the planner produces zero decisions, but the projector must handle N≥0).
- `weave.blueprint-approved`: sets `run.currentBlueprintVersion`, transitions status to `"running"`, applies `concurrencyCap`.

- [ ] **Step 3.1: Write failing tests**

Append to `weaveProjector.test.ts`:

```ts
import { BlueprintVersion, WeaveDecisionId, WeaveNodeId, WeavePhaseId } from "@t3tools/contracts";

describe("projectWeaveEvent — weave.blueprint-compiled", () => {
  it("sets currentBlueprint, transitions to reviewing, hydrates nodeStatuses and openDecisions", async () => {
    const createdEvent = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const initial = await Effect.runPromise(projectWeaveEvent(null, createdEvent));

    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [
          {
            id: WeaveNodeId.make("node-1"),
            title: "First",
            description: "",
            kind: "scaffold",
            phaseId: WeavePhaseId.make("phase-1"),
            scope: { readSet: [], writeSet: [] },
            inputContractIds: [],
            outputContractIds: [],
            verifierDescription: "",
            dependsOn: [],
            status: "pending",
          },
          {
            id: WeaveNodeId.make("node-2"),
            title: "Second",
            description: "",
            kind: "raw",
            phaseId: WeavePhaseId.make("phase-1"),
            scope: { readSet: [], writeSet: [] },
            inputContractIds: [],
            outputContractIds: [],
            verifierDescription: "",
            dependsOn: [WeaveNodeId.make("node-1")],
            status: "pending",
          },
        ],
        phases: [
          {
            id: WeavePhaseId.make("phase-1"),
            ordinal: 0,
            title: "Foundations",
            description: "",
            approval: "pending",
          },
        ],
        contracts: [],
        decisions: [
          {
            id: WeaveDecisionId.make("decision-1"),
            question: "Pick a state library.",
            options: ["jotai", "zustand"],
            blastRadiusNodeIds: [],
          },
        ],
        compiledAt: now,
        compiledBy: "planner",
      },
    });

    const result = await Effect.runPromise(projectWeaveEvent(initial, compiled));

    expect(result.run.status).toBe("reviewing");
    expect(result.currentBlueprint?.version).toBe(BlueprintVersion.make(1));
    expect(result.nodeStatuses.get(WeaveNodeId.make("node-1"))).toBe("pending");
    expect(result.nodeStatuses.get(WeaveNodeId.make("node-2"))).toBe("pending");
    expect(result.openDecisions.has(WeaveDecisionId.make("decision-1"))).toBe(true);
  });

  it("excludes already-resolved decisions from openDecisions", async () => {
    const createdEvent = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-2"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const initial = await Effect.runPromise(projectWeaveEvent(null, createdEvent));

    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-2"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [
          {
            id: WeaveDecisionId.make("decision-resolved"),
            question: "Q",
            options: ["a"],
            blastRadiusNodeIds: [],
            resolution: {
              answer: "a",
              byUser: true,
              resolvedAt: now,
            },
          },
          {
            id: WeaveDecisionId.make("decision-open"),
            question: "Q",
            options: ["a"],
            blastRadiusNodeIds: [],
          },
        ],
        compiledAt: now,
        compiledBy: "planner",
      },
    });

    const result = await Effect.runPromise(projectWeaveEvent(initial, compiled));
    expect(result.openDecisions.has(WeaveDecisionId.make("decision-open"))).toBe(true);
    expect(result.openDecisions.has(WeaveDecisionId.make("decision-resolved"))).toBe(false);
  });
});

describe("projectWeaveEvent — weave.blueprint-approved", () => {
  it("sets currentBlueprintVersion, transitions to running, applies concurrencyCap", async () => {
    // Build an initial state that has a compiled blueprint, using two projections.
    const createdEvent = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const created = await Effect.runPromise(projectWeaveEvent(null, createdEvent));
    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner",
      },
    });
    const reviewing = await Effect.runPromise(projectWeaveEvent(created, compiled));

    const approved = weaveEvent("weave.blueprint-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      concurrencyCap: 1,
      occurredAt: now,
    });

    const result = await Effect.runPromise(projectWeaveEvent(reviewing, approved));
    expect(result.run.status).toBe("running");
    expect(result.run.currentBlueprintVersion).toBe(BlueprintVersion.make(1));
    expect(result.run.concurrencyCap).toBe(1);
  });
});
```

- [ ] **Step 3.2: Run to verify failures**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: the new 3 tests fail (each falls through to the default no-op branch).

- [ ] **Step 3.3: Implement the two cases**

In `weaveProjector.ts`, replace the `default:` of the switch with two new `case` blocks before the fallthrough. The file's switch now looks like:

```ts
switch (event.type) {
  case "weave.created": {
    // ... unchanged from Task 2 ...
  }
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
    const nextNodeStatuses = new Map<WeaveNodeId, WeaveNodeStatus>();
    for (const node of payload.blueprint.nodes) {
      nextNodeStatuses.set(node.id, "pending");
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
      nodeStatuses: nextNodeStatuses,
      openDecisions: nextOpenDecisions,
    });
  }
  case "weave.blueprint-approved": {
    if (state === null) {
      return Effect.fail(
        new OrchestrationProjectorDecodeError({
          eventType: event.type,
          issue: `weave.blueprint-approved requires existing projection (null received).`,
        }),
      );
    }
    const { payload } = event;
    return Effect.succeed({
      ...state,
      run: {
        ...state.run,
        status: "running",
        currentBlueprintVersion: payload.version,
        concurrencyCap: payload.concurrencyCap,
      },
    });
  }
  default: {
    // Placeholder: Tasks 4–5 add the remaining 6 event cases.
    if (state === null) {
      return Effect.fail(
        new OrchestrationProjectorDecodeError({
          eventType: event.type,
          issue: `weave event ${event.type} requires a pre-existing projection (null received)`,
        }),
      );
    }
    return Effect.succeed(state);
  }
}
```

- [ ] **Step 3.4: Run to verify pass**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: all existing tests plus 3 new pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts \
        apps/server/src/orchestration/weaveProjector.test.ts
git commit -m "feat(server): project weave.blueprint-compiled and -approved"
```

---

## Task 4: Projector cases — node lifecycle events

**Files:**

- Modify: `apps/server/src/orchestration/weaveProjector.ts`
- Modify: `apps/server/src/orchestration/weaveProjector.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 3 → Task 2 → Task 1.

Three events: `weave.node-dispatched`, `weave.node-verified`, `weave.node-failed`. Each mutates `nodeStatuses`. `dispatched` also records `{ threadId, worktreePath }` in `childThreads`.

- [ ] **Step 4.1: Write failing tests**

Append to `weaveProjector.test.ts`:

```ts
import { ThreadId } from "@t3tools/contracts";

describe("projectWeaveEvent — node lifecycle", () => {
  async function runningProjectionWithNode(nodeId: WeaveNodeId) {
    const created = weaveEvent("weave.created", {
      weaveRunId: WeaveRunId.make("run-1"),
      projectId: ProjectId.make("project-1"),
      title: "X",
      vision: "",
      occurredAt: now,
    });
    const p0 = await Effect.runPromise(projectWeaveEvent(null, created));
    const compiled = weaveEvent("weave.blueprint-compiled", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      compiledBy: "planner",
      occurredAt: now,
      blueprint: {
        version: BlueprintVersion.make(1),
        nodes: [
          {
            id: nodeId,
            title: "Only",
            description: "",
            kind: "scaffold",
            phaseId: WeavePhaseId.make("phase-1"),
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
            id: WeavePhaseId.make("phase-1"),
            ordinal: 0,
            title: "Phase 1",
            description: "",
            approval: "pending",
          },
        ],
        contracts: [],
        decisions: [],
        compiledAt: now,
        compiledBy: "planner",
      },
    });
    const p1 = await Effect.runPromise(projectWeaveEvent(p0, compiled));
    const approved = weaveEvent("weave.blueprint-approved", {
      weaveRunId: WeaveRunId.make("run-1"),
      version: BlueprintVersion.make(1),
      concurrencyCap: 1,
      occurredAt: now,
    });
    return await Effect.runPromise(projectWeaveEvent(p1, approved));
  }

  it("weave.node-dispatched flips nodeStatus to running and records childThreads entry", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatched = weaveEvent("weave.node-dispatched", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      childThreadId: ThreadId.make("thread-1"),
      worktreePath: "/tmp/wt/node-1",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    expect(result.nodeStatuses.get(nodeId)).toBe("running");
    expect(result.childThreads.get(nodeId)?.threadId).toBe(ThreadId.make("thread-1"));
    expect(result.childThreads.get(nodeId)?.worktreePath).toBe("/tmp/wt/node-1");
  });

  it("weave.node-verified flips nodeStatus to verified", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatched = weaveEvent("weave.node-dispatched", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      childThreadId: ThreadId.make("thread-1"),
      worktreePath: "/tmp/wt/node-1",
      occurredAt: now,
    });
    const running = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    const verified = weaveEvent("weave.node-verified", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      verifierOutcome: "tests-passed",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(running, verified));
    expect(result.nodeStatuses.get(nodeId)).toBe("verified");
  });

  it("weave.node-failed flips nodeStatus to failed", async () => {
    const nodeId = WeaveNodeId.make("node-1");
    const state = await runningProjectionWithNode(nodeId);
    const dispatched = weaveEvent("weave.node-dispatched", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      childThreadId: ThreadId.make("thread-1"),
      worktreePath: "/tmp/wt/node-1",
      occurredAt: now,
    });
    const running = await Effect.runPromise(projectWeaveEvent(state, dispatched));
    const failed = weaveEvent("weave.node-failed", {
      weaveRunId: WeaveRunId.make("run-1"),
      nodeId,
      reason: "Verifier exit 1",
      occurredAt: now,
    });
    const result = await Effect.runPromise(projectWeaveEvent(running, failed));
    expect(result.nodeStatuses.get(nodeId)).toBe("failed");
  });
});
```

- [ ] **Step 4.2: Run to verify failures**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: 3 new tests fail.

- [ ] **Step 4.3: Implement the three cases**

Add before the `default:` in `weaveProjector.ts`:

```ts
case "weave.node-dispatched": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.node-dispatched requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  const nextNodeStatuses = new Map(state.nodeStatuses);
  nextNodeStatuses.set(payload.nodeId, "running");
  const nextChildThreads = new Map(state.childThreads);
  nextChildThreads.set(payload.nodeId, {
    threadId: payload.childThreadId,
    worktreePath: payload.worktreePath,
  });
  return Effect.succeed({
    ...state,
    nodeStatuses: nextNodeStatuses,
    childThreads: nextChildThreads,
  });
}
case "weave.node-verified": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.node-verified requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  const nextNodeStatuses = new Map(state.nodeStatuses);
  nextNodeStatuses.set(payload.nodeId, "verified");
  return Effect.succeed({ ...state, nodeStatuses: nextNodeStatuses });
}
case "weave.node-failed": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.node-failed requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  const nextNodeStatuses = new Map(state.nodeStatuses);
  nextNodeStatuses.set(payload.nodeId, "failed");
  return Effect.succeed({ ...state, nodeStatuses: nextNodeStatuses });
}
```

- [ ] **Step 4.4: Run to verify pass**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: all pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts \
        apps/server/src/orchestration/weaveProjector.test.ts
git commit -m "feat(server): project weave node lifecycle (dispatched/verified/failed)"
```

---

## Task 5: Projector cases — decision, phase, exit (final three events)

**Files:**

- Modify: `apps/server/src/orchestration/weaveProjector.ts`
- Modify: `apps/server/src/orchestration/weaveProjector.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 4 → Task 3 → Task 2.

Three events:

- `weave.decision-resolved`: remove from `openDecisions`. If `payload.byUser === false`, append to `autoDecisionLog` (`{ decisionId, answer, at: occurredAt }`).
- `weave.phase-approved`: update `phaseApprovals.set(phaseId, approval)`. No run-status change here — that's the decider's responsibility via a separate `weave.exited` emission.
- `weave.exited`: set `run.status` to `reason` (`"complete"` or `"aborted"`).

- [ ] **Step 5.1: Write failing tests**

Append to `weaveProjector.test.ts`. Full tests omitted for brevity in the plan; they follow the same fixture pattern as Task 4 — build a running projection, emit the event, assert the resulting field:

- `decision-resolved` by user → decision leaves `openDecisions`, `autoDecisionLog` unchanged.
- `decision-resolved` by AI (`byUser: false`) → decision leaves `openDecisions`, `autoDecisionLog` has one entry `{ decisionId, answer, at }`.
- `phase-approved` → `phaseApprovals.get(phaseId) === "approved"`.
- `phase-approved` with rejection → `phaseApprovals.get(phaseId) === "rejected"`.
- `exited` complete → `run.status === "complete"`.
- `exited` aborted → `run.status === "aborted"`.

Spell out each test in the usual `it("…", async () => { … })` form with `await Effect.runPromise(...)`; the test file conventions are established in Tasks 2–4 and must not be abbreviated in actual implementation code. The plan budget here is the test _names_ and the _property assertions_; the implementer fills the fixture-building boilerplate following Task 4's `runningProjectionWithNode` helper.

- [ ] **Step 5.2: Run to verify failures**

- [ ] **Step 5.3: Implement the three cases**

```ts
case "weave.decision-resolved": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.decision-resolved requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  const nextOpenDecisions = new Set(state.openDecisions);
  nextOpenDecisions.delete(payload.decisionId);
  const nextAutoDecisionLog = payload.byUser
    ? state.autoDecisionLog
    : [
        ...state.autoDecisionLog,
        { decisionId: payload.decisionId, answer: payload.answer, at: payload.occurredAt },
      ];
  return Effect.succeed({
    ...state,
    openDecisions: nextOpenDecisions,
    autoDecisionLog: nextAutoDecisionLog,
  });
}
case "weave.phase-approved": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.phase-approved requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  const nextPhaseApprovals = new Map(state.phaseApprovals);
  nextPhaseApprovals.set(payload.phaseId, payload.approval);
  return Effect.succeed({ ...state, phaseApprovals: nextPhaseApprovals });
}
case "weave.exited": {
  if (state === null) {
    return Effect.fail(
      new OrchestrationProjectorDecodeError({
        eventType: event.type,
        issue: `weave.exited requires existing projection (null received).`,
      }),
    );
  }
  const { payload } = event;
  return Effect.succeed({
    ...state,
    run: { ...state.run, status: payload.reason },
  });
}
```

Remove the old `default:` placeholder and replace with an exhaustiveness guard:

```ts
default: {
  const _exhaustive: never = event;
  void _exhaustive;
  return Effect.succeed(state);
}
```

After Tasks 2–5 all 9 weave event types are handled; the exhaustiveness check ensures future additions surface at compile time.

- [ ] **Step 5.4: Run all projector tests**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveProjector.test.ts`

Expected: all pass (tests from Tasks 2–5 combined — approximately 11 tests).

- [ ] **Step 5.5: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.ts \
        apps/server/src/orchestration/weaveProjector.test.ts
git commit -m "feat(server): project weave decision-resolved, phase-approved, exited"
```

---

## Task 6: Decider case — `weave.create`

**Files:**

- Create: `apps/server/src/orchestration/weaveDecider.ts`
- Create: `apps/server/src/orchestration/weaveDecider.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 5 → Task 4 → Task 3.

Logic: `weave.create` is valid when `projection === null` (use `requireRunAbsent`). Emits a single `weave.created` envelope-wrapped event. EventId is generated via `crypto.randomUUID()` (matching main `decider.ts` style). `occurredAt` uses `command.createdAt`.

- [ ] **Step 6.1: Create `weaveDecider.ts` with the full scaffolding (switch stub + `weave.create` case)**

```ts
import type { OrchestrationEvent, WeaveCommand, WeaveRunId } from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { requireRunAbsent } from "./weaveCommandInvariants.ts";
import type { WeaveRunProjection } from "./weaveProjector.ts";

// PlannedWeaveEvent: a weave-aggregate OrchestrationEvent minus `sequence`
// (the engine assigns it later). All envelope fields except sequence are
// produced here so the decider's output matches the main decider's shape.
export type PlannedWeaveEvent = Omit<
  Extract<OrchestrationEvent, { readonly aggregateKind: "weave" }>,
  "sequence"
>;

type WeaveEventType = PlannedWeaveEvent["type"];

function envelope<T extends WeaveEventType>(input: {
  readonly type: T;
  readonly weaveRunId: WeaveRunId;
  readonly occurredAt: string;
  readonly commandId: WeaveCommand["commandId"];
  readonly payload: Extract<PlannedWeaveEvent, { type: T }>["payload"];
}): Extract<PlannedWeaveEvent, { type: T }> {
  return {
    eventId: crypto.randomUUID() as never,
    aggregateKind: "weave",
    aggregateId: input.weaveRunId,
    type: input.type,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: {},
    payload: input.payload,
  } as Extract<PlannedWeaveEvent, { type: T }>;
}

export function decideWeaveCommand(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<ReadonlyArray<PlannedWeaveEvent>, OrchestrationCommandInvariantError> {
  const { projection, command } = input;

  switch (command.type) {
    case "weave.create": {
      return Effect.gen(function* () {
        yield* requireRunAbsent({ projection, command });
        return [
          envelope({
            type: "weave.created",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              projectId: command.projectId,
              title: command.title,
              vision: command.vision,
              parentThreadId: command.parentThreadId,
              parentMessageId: command.parentMessageId,
              snapshotContent: command.snapshotContent,
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    // Placeholder for Tasks 7–9.
    default: {
      return Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Decider does not yet handle '${command.type}' (pending Slice 2 tasks).`,
        }),
      );
    }
  }
}
```

- [ ] **Step 6.2: Write the failing test**

Create `apps/server/src/orchestration/weaveDecider.test.ts`:

```ts
import { CommandId, ProjectId, WeaveRunId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideWeaveCommand } from "./weaveDecider.ts";
import { createEmptyWeaveProjection, type WeaveRunProjection } from "./weaveProjector.ts";

const now = new Date().toISOString();

const emptyProjection = (runId = "run-1"): WeaveRunProjection =>
  createEmptyWeaveProjection({
    id: WeaveRunId.make(runId),
    projectId: ProjectId.make("project-1"),
    title: "X",
    vision: "",
    status: "draft",
    concurrencyCap: 1,
    createdAt: now,
  });

describe("decideWeaveCommand — weave.create", () => {
  it("emits weave.created when the run does not exist", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: null,
        command: {
          type: "weave.create",
          commandId: CommandId.make("cmd-1"),
          weaveRunId: WeaveRunId.make("run-1"),
          projectId: ProjectId.make("project-1"),
          title: "Test Run",
          vision: "# Goal",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("weave.created");
    expect(events[0].aggregateKind).toBe("weave");
    expect(events[0].aggregateId).toBe(WeaveRunId.make("run-1"));
    if (events[0].type === "weave.created") {
      expect(events[0].payload.title).toBe("Test Run");
    }
  });

  it("rejects weave.create when run already exists", async () => {
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: emptyProjection(),
          command: {
            type: "weave.create",
            commandId: CommandId.make("cmd-2"),
            weaveRunId: WeaveRunId.make("run-1"),
            projectId: ProjectId.make("project-1"),
            title: "dup",
            vision: "",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("already exists");
  });
});
```

- [ ] **Step 6.3: Run to verify pass**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveDecider.test.ts`

Expected: both tests pass (file was written in 6.1 already — the "write failing test" step here is for the remaining cases in Tasks 7–9 which will follow strict TDD; `weave.create` is the baseline that establishes the scaffolding).

- [ ] **Step 6.4: Commit**

```bash
git add apps/server/src/orchestration/weaveDecider.ts \
        apps/server/src/orchestration/weaveDecider.test.ts
git commit -m "feat(server): decide weave.create command"
```

---

## Task 7: Decider cases — `weave.blueprint.compile`, `weave.blueprint.approve`, `weave.exit`

**Files:**

- Modify: `apps/server/src/orchestration/weaveDecider.ts`
- Modify: `apps/server/src/orchestration/weaveDecider.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 6 → Task 5 → Task 4.

Per spec §2.3:

- **`weave.blueprint.compile`** — valid when run in `"draft"` (reason `"initial"`) or `"running"`/`"reviewing"` (reason `"amendment"`/`"redesign"`). Decider emits **no events** — the planner emits `weave.blueprint-compiled` directly in Slice 3. Returns `[]`. Invariant-only.
- **`weave.blueprint.approve`** — valid when run in `"reviewing"` with `currentBlueprintVersion` matching command. Emits `weave.blueprint-approved`.
- **`weave.exit`** — valid when run not `"complete"` or `"aborted"`. Emits `weave.exited` with payload reason from command.

- [ ] **Step 7.1: Write failing tests**

Append to `weaveDecider.test.ts`:

```ts
import { BlueprintVersion } from "@t3tools/contracts";

describe("decideWeaveCommand — weave.blueprint.compile", () => {
  it("returns [] when run is in draft with reason=initial (planner emits event directly)", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: emptyProjection(),
        command: {
          type: "weave.blueprint.compile",
          commandId: CommandId.make("cmd-c"),
          weaveRunId: WeaveRunId.make("run-1"),
          reason: "initial",
          createdAt: now,
        },
      }),
    );
    expect(events).toEqual([]);
  });

  it("rejects when run is complete", async () => {
    const p = {
      ...emptyProjection(),
      run: { ...emptyProjection().run, status: "complete" as const },
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.blueprint.compile",
            commandId: CommandId.make("cmd-c"),
            weaveRunId: WeaveRunId.make("run-1"),
            reason: "amendment",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("decideWeaveCommand — weave.blueprint.approve", () => {
  it("emits weave.blueprint-approved when version matches and run is reviewing", async () => {
    const p: WeaveRunProjection = {
      ...emptyProjection(),
      run: {
        ...emptyProjection().run,
        status: "reviewing",
        currentBlueprintVersion: BlueprintVersion.make(1),
      },
    };
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: p,
        command: {
          type: "weave.blueprint.approve",
          commandId: CommandId.make("cmd-a"),
          weaveRunId: WeaveRunId.make("run-1"),
          blueprintVersion: BlueprintVersion.make(1),
          concurrencyCap: 1,
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("weave.blueprint-approved");
  });

  it("rejects when version mismatches", async () => {
    const p: WeaveRunProjection = {
      ...emptyProjection(),
      run: {
        ...emptyProjection().run,
        status: "reviewing",
        currentBlueprintVersion: BlueprintVersion.make(1),
      },
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.blueprint.approve",
            commandId: CommandId.make("cmd-a"),
            weaveRunId: WeaveRunId.make("run-1"),
            blueprintVersion: BlueprintVersion.make(2),
            concurrencyCap: 1,
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("version mismatch");
  });

  it("rejects when run not in reviewing", async () => {
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: emptyProjection(), // status=draft
          command: {
            type: "weave.blueprint.approve",
            commandId: CommandId.make("cmd-a"),
            weaveRunId: WeaveRunId.make("run-1"),
            blueprintVersion: BlueprintVersion.make(1),
            concurrencyCap: 1,
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("decideWeaveCommand — weave.exit", () => {
  it("emits weave.exited with reason from command", async () => {
    const events = await Effect.runPromise(
      decideWeaveCommand({
        projection: emptyProjection(),
        command: {
          type: "weave.exit",
          commandId: CommandId.make("cmd-x"),
          weaveRunId: WeaveRunId.make("run-1"),
          reason: "aborted",
          createdAt: now,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("weave.exited");
    if (events[0].type === "weave.exited") {
      expect(events[0].payload.reason).toBe("aborted");
    }
  });

  it("rejects when run already complete", async () => {
    const p = {
      ...emptyProjection(),
      run: { ...emptyProjection().run, status: "complete" as const },
    };
    await expect(
      Effect.runPromise(
        decideWeaveCommand({
          projection: p,
          command: {
            type: "weave.exit",
            commandId: CommandId.make("cmd-x"),
            weaveRunId: WeaveRunId.make("run-1"),
            reason: "complete",
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow("already terminated");
  });
});
```

- [ ] **Step 7.2: Run to verify failures**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveDecider.test.ts`

Expected: new tests fail (default branch returns invariant error for all three).

- [ ] **Step 7.3: Implement the three cases**

Add to `weaveDecider.ts` switch, before the default. Update imports to pull `requireRun`, `requireStatus`, `requireRunNotTerminal`, `requireBlueprintVersion` from `./weaveCommandInvariants.ts`:

```ts
case "weave.blueprint.compile": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    const allowed = command.reason === "initial"
      ? (["draft"] as const)
      : (["running", "reviewing"] as const);
    yield* requireStatus({ projection: run, command, allowed });
    return []; // Planner emits the event; decider only validates.
  });
}
case "weave.blueprint.approve": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireStatus({ projection: run, command, allowed: ["reviewing"] });
    yield* requireBlueprintVersion({
      projection: run,
      command,
      version: command.blueprintVersion,
    });
    return [
      envelope({
        type: "weave.blueprint-approved",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          version: command.blueprintVersion,
          concurrencyCap: command.concurrencyCap,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
case "weave.exit": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireRunNotTerminal({ projection: run, command });
    return [
      envelope({
        type: "weave.exited",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          reason: command.reason,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
```

- [ ] **Step 7.4: Run to verify pass**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveDecider.test.ts`

Expected: all pass.

- [ ] **Step 7.5: Commit**

```bash
git add apps/server/src/orchestration/weaveDecider.ts \
        apps/server/src/orchestration/weaveDecider.test.ts
git commit -m "feat(server): decide weave.blueprint.compile, weave.blueprint.approve, weave.exit"
```

---

## Task 8: Decider cases — node lifecycle (`dispatch`, `verified`, `failed`)

**Files:**

- Modify: `apps/server/src/orchestration/weaveDecider.ts`
- Modify: `apps/server/src/orchestration/weaveDecider.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 7 → Task 6 → Task 5.

Per spec §2.3:

- **`weave.node.dispatch`** — valid when run `"running"`, node in `"ready"`, ancestors all `"verified"`. Emits `weave.node-dispatched`. Node-status transition `"ready"` → `"running"` happens in the projector.
- **`weave.node.verified`** — valid when run `"running"`, node in `"running"`, `verifierOutcome` non-empty. Emits `weave.node-verified`. If node was **last in its phase**, **ALSO** emits a `weave.phase-approved` event with `approval: "approved"` (v0.1's pseudo-auto-approve per spec §2.3). If that phase was **last in blueprint**, ALSO emits `weave.exited` with `reason: "complete"`.
- **`weave.node.failed`** — valid when run `"running"`, node in `"running"`. Emits `weave.node-failed`.

**Ancestor-verified check:** for `weave.node.dispatch`, validate that every `WeaveNode` in `command.node.dependsOn` has `nodeStatuses.get(dep) === "verified"`. Introduce a `requireAncestorsVerified` helper in `weaveCommandInvariants.ts` if helpful; inline if trivial.

**Last-in-phase detection:** after `weave.node.verified`, check `currentBlueprint.nodes.filter(n => n.phaseId === verifiedNode.phaseId)` and count how many have `nodeStatuses.get(n.id) === "verified"` after applying the current event. If all nodes in the phase are verified, emit `weave.phase-approved`.

**Last-phase detection:** after auto-approving a phase, check if that phase is the maximum-ordinal phase in `currentBlueprint.phases`. If yes, all prior phases are already `"approved"` (enforce this as an invariant — if not, skip the exit emission and log; v0.1 expects sequential phase completion). If everything checks out, emit `weave.exited` with reason `"complete"`.

Given the multi-event nature of `weave.node.verified`, this is the most complex case. Keep the logic separate: compute the base event, then compute implied events via helper functions.

- [ ] **Step 8.1: Write failing tests**

Cover per case:

- `dispatch`: emits `weave.node-dispatched` when ancestors verified; rejects when run not running, when node not ready, when ancestor unverified.
- `verified`: emits `weave.node-verified` (single event) when other nodes in phase still pending; emits 2 events (`weave.node-verified` + `weave.phase-approved`) when this verification completes the phase but not the blueprint; emits 3 events when it completes the final phase (+ `weave.exited` with `reason: "complete"`); rejects when `verifierOutcome` is empty; rejects when node not running.
- `failed`: emits `weave.node-failed`; rejects on bad node status.

Because these tests are nontrivial, spell out all of them in the implementation (the plan lists test _names_ and fixture patterns; the implementer fills in the bodies following Tasks 6/7's style). Minimum test count: **10** (3 for dispatch, 5 for verified covering the three emission shapes + 2 rejection cases, 2 for failed).

- [ ] **Step 8.2: Run to verify failures**

- [ ] **Step 8.3: Implement the three cases**

Extend `weaveCommandInvariants.ts` with `requireAncestorsVerified`:

```ts
export function requireAncestorsVerified(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly node: WeaveNode;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  for (const ancestorId of input.node.dependsOn) {
    const status = input.projection.nodeStatuses.get(ancestorId);
    if (status !== "verified") {
      return fail(
        input.command,
        `ancestor '${ancestorId}' of node '${input.node.id}' has status '${status ?? "unknown"}'; expected 'verified'.`,
      );
    }
  }
  return Effect.void;
}
```

Extend `weaveDecider.ts` with the three cases. The `weave.node.verified` case invokes two helpers inline:

```ts
function isPhaseNowComplete(
  blueprint: Blueprint,
  nodeStatuses: ReadonlyMap<WeaveNodeId, WeaveNodeStatus>,
  phaseId: WeavePhaseId,
  justVerifiedNodeId: WeaveNodeId,
): boolean {
  const phaseNodes = blueprint.nodes.filter((n) => n.phaseId === phaseId);
  return phaseNodes.every((n) =>
    n.id === justVerifiedNodeId ? true : nodeStatuses.get(n.id) === "verified",
  );
}

function isLastPhase(blueprint: Blueprint, phaseId: WeavePhaseId): boolean {
  const maxOrdinal = Math.max(...blueprint.phases.map((p) => p.ordinal));
  const phase = blueprint.phases.find((p) => p.id === phaseId);
  return phase !== undefined && phase.ordinal === maxOrdinal;
}
```

Then the switch cases:

```ts
case "weave.node.dispatch": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireStatus({ projection: run, command, allowed: ["running"] });
    yield* requireNodeStatus({
      projection: run,
      command,
      nodeId: command.nodeId,
      allowed: ["ready"],
    });
    const node = yield* requireNode({ projection: run, command, nodeId: command.nodeId });
    yield* requireAncestorsVerified({ projection: run, command, node });
    return [
      envelope({
        type: "weave.node-dispatched",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          nodeId: command.nodeId,
          childThreadId: command.childThreadId,
          worktreePath: command.worktreePath,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
case "weave.node.verified": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireStatus({ projection: run, command, allowed: ["running"] });
    yield* requireNodeStatus({
      projection: run,
      command,
      nodeId: command.nodeId,
      allowed: ["running"],
    });
    if (command.verifierOutcome.trim().length === 0) {
      return yield* Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `verifierOutcome must be non-empty.`,
        }),
      );
    }
    const node = yield* requireNode({ projection: run, command, nodeId: command.nodeId });
    const results: PlannedWeaveEvent[] = [
      envelope({
        type: "weave.node-verified",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          nodeId: command.nodeId,
          verifierOutcome: command.verifierOutcome,
          occurredAt: command.createdAt,
        },
      }),
    ];
    const bp = run.currentBlueprint;
    if (bp !== null && isPhaseNowComplete(bp, run.nodeStatuses, node.phaseId, command.nodeId)) {
      results.push(
        envelope({
          type: "weave.phase-approved",
          weaveRunId: command.weaveRunId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          payload: {
            weaveRunId: command.weaveRunId,
            phaseId: node.phaseId,
            approval: "approved",
            occurredAt: command.createdAt,
          },
        }),
      );
      if (isLastPhase(bp, node.phaseId)) {
        results.push(
          envelope({
            type: "weave.exited",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              reason: "complete",
              occurredAt: command.createdAt,
            },
          }),
        );
      }
    }
    return results;
  });
}
case "weave.node.failed": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireStatus({ projection: run, command, allowed: ["running"] });
    yield* requireNodeStatus({
      projection: run,
      command,
      nodeId: command.nodeId,
      allowed: ["running"],
    });
    return [
      envelope({
        type: "weave.node-failed",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          nodeId: command.nodeId,
          reason: command.reason,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
```

- [ ] **Step 8.4: Run to verify pass**

- [ ] **Step 8.5: Commit**

```bash
git add apps/server/src/orchestration/weaveDecider.ts \
        apps/server/src/orchestration/weaveDecider.test.ts \
        apps/server/src/orchestration/weaveCommandInvariants.ts \
        apps/server/src/orchestration/weaveCommandInvariants.test.ts
git commit -m "feat(server): decide weave node lifecycle with auto phase+run closure"
```

---

## Task 9: Decider cases — `weave.decision.resolve`, `weave.phase.approve`

**Files:**

- Modify: `apps/server/src/orchestration/weaveDecider.ts`
- Modify: `apps/server/src/orchestration/weaveDecider.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 8 → Task 7 → Task 6.

Per spec §2.3:

- **`weave.decision.resolve`** — valid when decision is in `openDecisions`. Emits `weave.decision-resolved`.
- **`weave.phase.approve`** — valid when phase pending. Emits `weave.phase-approved`. If phase was last in blueprint AND approval is `"approved"`, ALSO emit `weave.exited` with reason `"complete"`.

- [ ] **Step 9.1: Write failing tests**

Cover per case:

- `decision.resolve`: emits event; rejects when decision not open.
- `phase.approve`: emits single event on non-last phase; emits 2 events (`weave.phase-approved` + `weave.exited`) when last phase + `"approved"`; emits 1 event (no auto-exit) on last phase + `"rejected"`; rejects when phase not pending.

- [ ] **Step 9.2: Run to verify failures**

- [ ] **Step 9.3: Implement**

```ts
case "weave.decision.resolve": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireRunNotTerminal({ projection: run, command });
    yield* requireOpenDecision({
      projection: run,
      command,
      decisionId: command.decisionId,
    });
    return [
      envelope({
        type: "weave.decision-resolved",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          decisionId: command.decisionId,
          answer: command.answer,
          byUser: command.byUser,
          rationale: command.rationale,
          occurredAt: command.createdAt,
        },
      }),
    ];
  });
}
case "weave.phase.approve": {
  return Effect.gen(function* () {
    const run = yield* requireRun({ projection, command });
    yield* requireRunNotTerminal({ projection: run, command });
    yield* requirePhasePending({
      projection: run,
      command,
      phaseId: command.phaseId,
    });
    const results: PlannedWeaveEvent[] = [
      envelope({
        type: "weave.phase-approved",
        weaveRunId: command.weaveRunId,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        payload: {
          weaveRunId: command.weaveRunId,
          phaseId: command.phaseId,
          approval: command.approval,
          occurredAt: command.createdAt,
        },
      }),
    ];
    if (
      command.approval === "approved" &&
      run.currentBlueprint !== null &&
      isLastPhase(run.currentBlueprint, command.phaseId)
    ) {
      results.push(
        envelope({
          type: "weave.exited",
          weaveRunId: command.weaveRunId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          payload: {
            weaveRunId: command.weaveRunId,
            reason: "complete",
            occurredAt: command.createdAt,
          },
        }),
      );
    }
    return results;
  });
}
```

Also replace the `default:` branch with an exhaustiveness guard (all 9 cases now handled):

```ts
default: {
  const _exhaustive: never = command;
  void _exhaustive;
  return Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: (command as { type: string }).type,
      detail: `Unknown weave command type.`,
    }),
  );
}
```

- [ ] **Step 9.4: Run to verify pass**

Run all decider tests: `cd apps/server && bun run test -- --run src/orchestration/weaveDecider.test.ts`

Expected: ~20 tests pass (3 create + 5 blueprint/exit + 10 node + 4 decision/phase, approximately).

- [ ] **Step 9.5: Commit**

```bash
git add apps/server/src/orchestration/weaveDecider.ts \
        apps/server/src/orchestration/weaveDecider.test.ts
git commit -m "feat(server): decide weave.decision.resolve and weave.phase.approve (closes Slice 2 case coverage)"
```

---

## Task 10: Integration test — decider + projector roundtrip

**Files:**

- Create: `apps/server/src/orchestration/weaveRoundtrip.test.ts`

**Pre-flight HEAD expectation:** top three commits Task 9 → Task 8 → Task 7.

Motivation: per-event and per-command tests verify the pieces work. A single roundtrip test drives a full happy-path sequence to catch integration bugs — especially the node-verified → phase-approved → exited cascade.

- [ ] **Step 10.1: Write the integration test**

Create `apps/server/src/orchestration/weaveRoundtrip.test.ts`:

```ts
import {
  BlueprintVersion,
  CommandId,
  ProjectId,
  ThreadId,
  WeaveCommand,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideWeaveCommand, type PlannedWeaveEvent } from "./weaveDecider.ts";
import {
  createEmptyWeaveProjection,
  projectWeaveEvent,
  type WeaveOrchestrationEvent,
  type WeaveRunProjection,
} from "./weaveProjector.ts";

const now = new Date().toISOString();

// Helper: run a command, project each resulting event, return next projection.
async function step(
  projection: WeaveRunProjection | null,
  command: WeaveCommand,
): Promise<{ events: ReadonlyArray<PlannedWeaveEvent>; projection: WeaveRunProjection }> {
  const events = await Effect.runPromise(decideWeaveCommand({ projection, command }));
  let next: WeaveRunProjection | null = projection;
  for (const e of events) {
    const sequenced = { ...e, sequence: 0 } as WeaveOrchestrationEvent;
    next = await Effect.runPromise(projectWeaveEvent(next, sequenced));
  }
  return { events, projection: next! };
}

describe("weave decider+projector roundtrip", () => {
  it("walks a 2-node 1-phase run from create to complete", async () => {
    const runId = WeaveRunId.make("run-1");
    const phaseId = WeavePhaseId.make("phase-1");
    const nodeA = WeaveNodeId.make("node-a");
    const nodeB = WeaveNodeId.make("node-b");

    // 1. create
    const s1 = await step(null, {
      type: "weave.create",
      commandId: CommandId.make("cmd-create"),
      weaveRunId: runId,
      projectId: ProjectId.make("project-1"),
      title: "Roundtrip",
      vision: "",
      createdAt: now,
    });
    expect(s1.projection.run.status).toBe("draft");

    // 2. simulate blueprint-compiled (not emitted by decider; we hand-craft)
    const compiledEvent: WeaveOrchestrationEvent = {
      sequence: 0,
      eventId: "evt-compiled" as never,
      aggregateKind: "weave",
      aggregateId: runId,
      type: "weave.blueprint-compiled",
      occurredAt: now,
      commandId: CommandId.make("cmd-compile"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-compile"),
      metadata: {},
      payload: {
        weaveRunId: runId,
        version: BlueprintVersion.make(1),
        compiledBy: "planner",
        occurredAt: now,
        blueprint: {
          version: BlueprintVersion.make(1),
          nodes: [
            /* node-a: ready, no deps */
            {
              id: nodeA,
              title: "A",
              description: "",
              kind: "scaffold",
              phaseId,
              scope: { readSet: [], writeSet: [] },
              inputContractIds: [],
              outputContractIds: [],
              verifierDescription: "",
              dependsOn: [],
              status: "pending",
            },
            /* node-b: depends on A */
            {
              id: nodeB,
              title: "B",
              description: "",
              kind: "raw",
              phaseId,
              scope: { readSet: [], writeSet: [] },
              inputContractIds: [],
              outputContractIds: [],
              verifierDescription: "",
              dependsOn: [nodeA],
              status: "pending",
            },
          ],
          phases: [
            {
              id: phaseId,
              ordinal: 0,
              title: "Only Phase",
              description: "",
              approval: "pending",
            },
          ],
          contracts: [],
          decisions: [],
          compiledAt: now,
          compiledBy: "planner",
        },
      },
    };
    const afterCompile = await Effect.runPromise(projectWeaveEvent(s1.projection, compiledEvent));
    expect(afterCompile.run.status).toBe("reviewing");

    // 3. approve blueprint
    const s3 = await step(afterCompile, {
      type: "weave.blueprint.approve",
      commandId: CommandId.make("cmd-approve"),
      weaveRunId: runId,
      blueprintVersion: BlueprintVersion.make(1),
      concurrencyCap: 1,
      createdAt: now,
    });
    expect(s3.projection.run.status).toBe("running");

    // 4. manually mark node-a ready (the scheduler normally does this; Slice 2's
    //    decider requires the caller to ensure node is in "ready" state before dispatch).
    const readyState: WeaveRunProjection = {
      ...s3.projection,
      nodeStatuses: new Map(s3.projection.nodeStatuses).set(nodeA, "ready"),
    };

    // 5. dispatch node-a
    const s5 = await step(readyState, {
      type: "weave.node.dispatch",
      commandId: CommandId.make("cmd-dispatch-a"),
      weaveRunId: runId,
      nodeId: nodeA,
      childThreadId: ThreadId.make("thread-a"),
      worktreePath: "/tmp/wt/a",
      createdAt: now,
    });
    expect(s5.projection.nodeStatuses.get(nodeA)).toBe("running");

    // 6. verify node-a (not last in phase — node-b still pending)
    const s6 = await step(s5.projection, {
      type: "weave.node.verified",
      commandId: CommandId.make("cmd-verified-a"),
      weaveRunId: runId,
      nodeId: nodeA,
      verifierOutcome: "tests-passed",
      createdAt: now,
    });
    expect(s6.events).toHaveLength(1);
    expect(s6.projection.nodeStatuses.get(nodeA)).toBe("verified");

    // 7. mark node-b ready
    const bReady: WeaveRunProjection = {
      ...s6.projection,
      nodeStatuses: new Map(s6.projection.nodeStatuses).set(nodeB, "ready"),
    };

    // 8. dispatch + verify node-b — this should emit 3 events (node-verified + phase-approved + exited)
    const s8 = await step(bReady, {
      type: "weave.node.dispatch",
      commandId: CommandId.make("cmd-dispatch-b"),
      weaveRunId: runId,
      nodeId: nodeB,
      childThreadId: ThreadId.make("thread-b"),
      worktreePath: "/tmp/wt/b",
      createdAt: now,
    });
    const s9 = await step(s8.projection, {
      type: "weave.node.verified",
      commandId: CommandId.make("cmd-verified-b"),
      weaveRunId: runId,
      nodeId: nodeB,
      verifierOutcome: "tests-passed",
      createdAt: now,
    });
    expect(s9.events.map((e) => e.type)).toEqual([
      "weave.node-verified",
      "weave.phase-approved",
      "weave.exited",
    ]);
    expect(s9.projection.run.status).toBe("complete");
    expect(s9.projection.phaseApprovals.get(phaseId)).toBe("approved");
  });
});
```

- [ ] **Step 10.2: Run**

Run: `cd apps/server && bun run test -- --run src/orchestration/weaveRoundtrip.test.ts`

Expected: the 1 test passes. If it fails in unexpected ways, it's surfacing a bug in prior tasks — diagnose before continuing.

- [ ] **Step 10.3: Commit**

```bash
git add apps/server/src/orchestration/weaveRoundtrip.test.ts
git commit -m "test(server): end-to-end weave decider+projector roundtrip"
```

---

## Task 11: Repo-wide Definition-of-Done gate

**Files:**

- None (validation only).

**Pre-flight HEAD expectation:** top three commits Task 10 → Task 9 → Task 8.

- [ ] **Step 11.1: Full typecheck**

`bun typecheck` from repo root.

Expected: 10/10 packages clean. The new files are pure TS under `apps/server/src/orchestration/` — if typecheck reports anything from that subtree, triage. Failures unrelated to Slice 2 (e.g. pre-existing warnings) don't count.

- [ ] **Step 11.2: Full test suite**

`bun run test` from repo root.

Expected: all tests pass. Note the Slice-1 carry-over: `apps/server/src/git/GitManager.test.ts` has pre-existing environmental failures (timeouts with real git operations). Those are not regressions from Slice 2. Verify with `git log --oneline weave-v0.1-slice-1..HEAD -- 'apps/server/src/git/'` — should be empty (no files in that subtree touched by this slice).

- [ ] **Step 11.3: Lint**

`bun lint` from repo root.

Expected: 0 errors. Pre-existing warnings in `apps/web/src/**` unrelated.

- [ ] **Step 11.4: Format**

`bun fmt` from repo root.

Expected: no files changed. If files are reformatted, commit as `chore(server): apply oxfmt`.

- [ ] **Step 11.5: Spec DoD verification ([spec §2.7](../../weave/v0.1-spec.md#27-definition-of-done))**

- [ ] All pure; no IO. `grep -En 'console|process\.|setTimeout|setInterval|fetch|readFile|writeFile' apps/server/src/orchestration/weave*.ts` returns nothing.
- [ ] No `Effect.sync` wrappers. `grep -n 'Effect.sync' apps/server/src/orchestration/weave*.ts` returns nothing.
- [ ] Edge cases documented in test names — confirm each decider-reject test has a name of the form `"rejects … when …"`.
- [ ] `bun run test` green — verified in 11.2.

- [ ] **Step 11.6: Commit trail review**

`git log --oneline weave-v0.1-slice-1..HEAD`

Expected (top-of-branch → bottom, 11 or 12 commits depending on whether a fmt-fixup commit was needed; the Slice 1 tag anchors the "new since Slice 1" range):

```
[optional: chore(server): apply oxfmt]
test(server): end-to-end weave decider+projector roundtrip
feat(server): decide weave.decision.resolve and weave.phase.approve (closes Slice 2 case coverage)
feat(server): decide weave node lifecycle with auto phase+run closure
feat(server): decide weave.blueprint.compile, weave.blueprint.approve, weave.exit
feat(server): decide weave.create command
feat(server): project weave decision-resolved, phase-approved, exited
feat(server): project weave node lifecycle (dispatched/verified/failed)
feat(server): project weave.blueprint-compiled and -approved
feat(server): project weave.created into a new WeaveRunProjection
feat(server): add WeaveRunProjection type and weave invariant helpers
docs: add Weave v0.1 Slice 2 (decider/projector/invariants) implementation plan
```

Slice 2 is complete. Close by tagging the final commit on `nikrabaev/weave`:

```bash
git tag weave-v0.1-slice-2
# optional offsite backup:
# git push origin nikrabaev/weave weave-v0.1-slice-2
```

No merge to `main` — all Weave work stays on `nikrabaev/weave` per the single-canonical-branch strategy. (`main` still tracks upstream t3code untouched.)

---

## Self-review summary

- **Spec coverage** ([§Slice 2](../../weave/v0.1-spec.md#slice-2--decider--projector--invariants-pure)): §2.1 files (six new, per-plan tasks 1, 2, 6 create the three pairs); §2.2 projection type (Task 1); §2.3 decider cases × 9 (Tasks 6–9 cover all 9 command types); §2.4 projector cases × 9 (Tasks 2–5 cover all 9 event types); §2.5 invariants (baked into Task 1 helpers + invoked across deciders); §2.6 tests (each task contributes tests + Task 10 is the integration/roundtrip); §2.7 DoD (Task 11).
- **Carry-over handling:**
  - **Pre-flight HEAD checks** — mandated at every task-implementer prompt via the plan's "Pre-flight HEAD check protocol" section, with per-task expected-SHA fills from the controller.
  - **Slice 1 stubs** — each stub is listed with its Slice 3 disposition in the "Context" section; Slice 2 removes NONE of them (stays pure).
  - **`(aggregateKind, aggregateId)` correlation** — deferred per user instruction; Slice 2's pure functions operate on `WeaveRunProjection` and never encounter the narrowing problem.
- **Placeholder scan:** tasks 5, 8, 9 reference test-name sets in prose rather than spelling out every `it("…")` block. This is because those case-sets are isomorphic to the cases in Tasks 2–4 and 6–7 — the pattern is established, the implementer fills the fixture boilerplate. If a future reviewer prefers full test code in every task, expand Tasks 5, 8, 9 in a revision.
- **Type consistency:** `WeaveRunProjection` is declared once in Task 1 and imported by every subsequent task. `PlannedWeaveEvent` is declared once in Task 6's scaffolding and used in Tasks 7–10. `envelope` helper declared once in Task 6; `isPhaseNowComplete` / `isLastPhase` in Task 8. Invariant helpers declared once in Task 1; `requireAncestorsVerified` is added in Task 8 as a dedicated extension.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-22-weave-v01-slice-2-decider-projector.md`.** Awaiting user review per the handoff directive in the original task. Do not begin execution.

When approved, per user instruction: use **superpowers:subagent-driven-development**. Dispatch one fresh subagent per task, with the mandatory pre-flight HEAD check inlined into each prompt. Model guidance:

- Tasks 1, 6, 8: **sonnet** — multi-function helpers / multi-case deciders with the most cross-cutting concerns.
- Tasks 2, 3, 4, 5, 7, 9, 10: **haiku** — mechanical per-event / per-command extensions after the scaffolding is in place.
- Task 11: **controller** (me, directly) — validation-only, no TDD, may require manual intervention if downstream packages regress.
