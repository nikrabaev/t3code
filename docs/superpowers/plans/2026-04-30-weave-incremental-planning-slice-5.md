# Weave Incremental Planning — Slice 5: Web UI (Planning Node rendering & multi-gate approval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-30-weave-incremental-planning-design.md`](../specs/2026-04-30-weave-incremental-planning-design.md) — see the **Implementation slices → Slice 5** entry plus **Component changes → Web** and **User-facing lifecycle**.

**Slice 1 outcome:** [`2026-04-30-weave-incremental-planning-slice-1.md`](2026-04-30-weave-incremental-planning-slice-1.md) — schema deltas (`WeaveNodeKind += "planning"`, `WeaveBlueprintCompileReason += "phase-planning"`, `WeaveRun.planningDepthCap`, `WeaveBlueprintExtendedPayload`, `WeaveBlueprintExtendCommand`, `weave.blueprint-extended` event variant).

**Slice 2 outcome:** [`2026-04-30-weave-incremental-planning-slice-2.md`](2026-04-30-weave-incremental-planning-slice-2.md) — meta-planner emits Planning Nodes only, `planningDepthCap` defaults to 3 at create.

**Slice 3 outcome:** [`2026-04-30-weave-incremental-planning-slice-3.md`](2026-04-30-weave-incremental-planning-slice-3.md) — `WeaveBlueprintExtendCommand.addedNodes`, `BlueprintSource += "phase-planning"`, `PhasePlannerOutput` schema, real decider/projector arms for `weave.blueprint.extend`, `buildPhasePlannerPrompt`, conformer recognizes `kind === "planning"`.

**Slice 4 outcome:** [`2026-04-30-weave-incremental-planning-slice-4.md`](2026-04-30-weave-incremental-planning-slice-4.md) — projector preserves `nodeMeta` across `weave.blueprint-compiled` (so a Planning Node's `verified` status survives the post-emission recompile), scheduler `computeReadySet` is kind-stratified (Phase Planning Nodes wait for prior-Phase verification), end-to-end integration test re-enabled. The server is now able to drive `create → meta-compile → approve v1 → P1 planner → emit → reviewing → approve v2 → P1 tasks → P2 planner auto-dispatch → emit → reviewing → approve v3 → P2 tasks → complete` end-to-end under stub drivers.

**Goal:** Slice 5 puts the user in front of that flow. Two pieces: (1) `WeaveBlueprintList` / `WeaveNodeCard` render `kind: "planning"` nodes with a distinguishable badge so users can tell a Planning Node apart from a Task at a glance; (2) `WeaveApproveCallout` adapts its headline + Tile counts to the current `Blueprint.compiledBy`, so when the run re-enters `reviewing` after a Phase Planner emission the user sees "Approve Phase X plan: N new Tasks" instead of the intake-time "Approve initial plan" copy. Additionally — and per the [Slice 4 Task 1 reviewer note](2026-04-30-weave-incremental-planning-slice-4.md) — Slice 5 retires the inline `Blueprint` literal duplication that landed in `weaveProjector.test.ts` by extracting a `makeMinimalBlueprint` helper.

**Architecture:** All work is web-side (`apps/web/src/components/weave/`) plus one server-side test cleanup. No backend behavior changes. The web changes lean on infrastructure that already exists:

- `Blueprint.compiledBy: BlueprintSource` (Slice 1 schema, Slice 3 added the `"phase-planning"` literal) is the single discriminator for "what kind of compile am I approving."
- `WeaveRunProjection.nodeMeta` (Map<WeaveNodeId, WeaveNodeMeta>) tells us which Planning Node was most recently `verified` — that's the Phase whose Tasks just appeared.
- The existing `shell.status === "reviewing"` predicate in `WeaveView.tsx` already shows the callout. It re-fires automatically when a `weave.blueprint-compiled` projection event lands, regardless of whether `compiledBy` is `"planner"` or `"phase-planning"`. Slice 5 doesn't change the predicate; it changes what the callout renders.

**Tech Stack:** React 19, Tanstack Router, base-ui components, Tailwind, vitest-browser-react + MSW for browser tests; `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` as the global gates.

---

## Out of scope for Slice 5

- **Edit Vision and Re-plan Phase actions.** The spec lists these as gate-time options (`Approve & run · Edit Vision · Re-plan Phase · Abort`), but they require new server commands (re-run the meta-planner with an updated Vision; re-dispatch a Planning Node with the user's rejection rationale) that don't exist yet. Slice 5 keeps the existing disabled "Edit Blueprint" placeholder unchanged. A follow-up slice will own the server commands plus the wiring.
- **Mid-Phase Planning Node user gates.** Per the design ("Phase-only gates" decision), mid-Phase emissions auto-promote without a gate. Slice 5 doesn't introduce a UI for them.
- **Live `PhasePlannerDriver` Layer.** Production wiring of an LLM for the Phase Planner is a server slice; Slice 4's integration test injected the agent's JSON output by hand and Slice 5 doesn't change that.
- **`WeavePlanner → MetaPlanner` rename + separate `PhasePlanner` service.** Cosmetic; deferred.
- **Approval history persistence.** Slice 5 derives "previously approved versions" by inspection of the current run state, not by storing a history. If the run reloads, we don't know which prior versions the user approved — and that's fine for Slice 5's scope: the user only acts on the current `reviewing` gate.
- **Per-Phase ordinal jump indicator** (e.g. "Phase 2 of 3"). The existing phase headings in `WeaveBlueprintList` already convey progression. A "you are here" highlight is a polish item; not blocking.
- **Diff visualization between Blueprint versions.** Showing a structured diff of "what's new in v3 vs v2" would be valuable but is out of scope. The user sees the new Tasks inline in the Blueprint list — that's the v0.2 affordance.

## Definition of done

- `WeaveNodeCard` renders a small "Planning" badge for `node.kind === "planning"` nodes; non-planning kinds render unchanged. The badge uses an existing tone (a muted variant) and is visually distinguishable from the status pill.
- `WeaveApproveCallout` reads `blueprint.compiledBy` and renders one of three headline variants:
  - `compiledBy === "planner"` → "Approve initial plan" (current copy preserved).
  - `compiledBy === "phase-planning"` → "Approve <Phase title> plan" with subhead "<N> new Tasks added since last approval."
  - `compiledBy === "amendment" | "redesign"` → "Approve plan update" (catch-all; the design includes these reasons but Slice 5 does not differentiate them further).

  The Tile row updates accordingly: for `phase-planning`, the Tiles show the count of newly-added nodes (delta), not the total node count, so the user sees the size of the change they're being asked to approve.

- A new browser test in `WeaveView.browser.tsx` covers both the `compiledBy: "planner"` (intake) and `compiledBy: "phase-planning"` (post-emission) variants. The post-emission variant asserts the Phase title appears in the headline AND that the Tile shows the delta count.
- `weaveProjector.test.ts` has a `makeMinimalBlueprint` helper near the top-of-file test helpers; the two `nodeMeta`-preservation tests added by Slice 4 Task 1 are migrated to use it. Net line delta is negative (the helper is shorter than the boilerplate it replaces).
- `bun typecheck`, `bun run test`, `bun lint`, `bun fmt` all pass with no new failures beyond the Slice 4 baseline (1033 passed / 4 skipped / 7 failed — all 7 are pre-existing GitManager network-timeout failures). Slice 5 is expected to add **+2 new passing browser tests** (one for the kind badge, one for the multi-gate headline) and the server-test count stays flat (the test-fixture refactor is a same-count rewrite). Post-slice baseline is roughly: ≥1035 passed / 4 skipped / 7 failed.
- Three small focused commits — one per implementation task plus an optional fmt commit if `bun fmt` reformats files this slice touched.

---

## File structure

| File                                                    | Change                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/weave/WeaveNodeCard.tsx`       | Add a `kind` badge for `kind === "planning"` nodes. Non-planning kinds render unchanged.                                                                                                                                                |
| `apps/web/src/components/weave/WeaveApproveCallout.tsx` | Read `blueprint.compiledBy`; switch headline copy + Tile row based on it. Compute `addedSinceLastApproval` count by walking `detail.nodeMeta` (planner-node-with-status-`verified` → its phase → that phase's nodes minus the planner). |
| `apps/web/src/components/weave/WeaveView.tsx`           | Pass `detail` (or just `nodeMeta`) into `WeaveApproveCallout` so it can compute the delta. Currently the callout only takes the blueprint; this slice adds the projection prop.                                                         |
| `apps/web/src/components/weave/WeaveView.browser.tsx`   | Append two new `it("...")` blocks — one for the kind badge, one for the multi-gate headline.                                                                                                                                            |
| `apps/server/src/orchestration/weaveProjector.test.ts`  | Add `makeMinimalBlueprint` helper; migrate the two Slice 4 Task 1 `nodeMeta`-preservation tests to use it.                                                                                                                              |

`WeaveBlueprintList.tsx` is **not** modified — it already groups by phase ordinal correctly. The kind badge belongs on the card, not the list.

`WeaveStatusPill.tsx` is **not** modified — the kind badge is a separate visual element from the status pill.

`packages/contracts/src/weave.ts` is **not** modified.

Server-side reactor / projector / decider code is **not** modified.

---

## Task 1: Planning Node kind badge in `WeaveNodeCard`

**Files:**

- Modify: `apps/web/src/components/weave/WeaveNodeCard.tsx`
- Modify: `apps/web/src/components/weave/WeaveView.browser.tsx` (append a new test)

**Why this matters:** Until Slice 5, the user sees a single homogeneous list of Tasks in `WeaveBlueprintList`. After Slice 4, that list also contains Planning Nodes (one per Phase, emitted by the meta-planner) with `kind: "planning"`. Without a badge, the user can't tell why a "node" with no `dependsOn` is sitting there at the top of each Phase — the affordance is muddy. A small badge next to the title disambiguates: "this is the agent that planned this Phase, not a piece of work you commissioned."

The badge appears for `kind === "planning"` only. The other kinds (`raw`, `scaffold`, `contract`, `utility`) are all "Task-like" from the user's perspective and don't need disambiguation in v0.2.

- [ ] **Step 1: Write a failing browser test for the badge**

Append at the end of `apps/web/src/components/weave/WeaveView.browser.tsx`, inside the `describe("WeaveView browser tests", () => { ... })` block. The test reuses the existing `mountApp` and `createWeaveRunProjection` helpers but constructs a custom blueprint with one Planning Node and one raw Task:

```ts
// --------------------------------------------------------------------------
// Test N: planning kind badge renders for planning nodes only
// --------------------------------------------------------------------------
it("renders a 'Planning' badge for kind=planning nodes and not for other kinds", async () => {
  const snapshot = createBaseSnapshot();
  const phaseId = PHASE_ID;
  const plannerNodeId = "phase-1-planner" as WeaveNodeId;
  const taskNodeId = "phase-1-task" as WeaveNodeId;
  const customBlueprint = {
    version: 1 as BlueprintVersion,
    nodes: [
      {
        id: plannerNodeId,
        title: "Phase 1 Planner",
        description: "Plan Phase 1",
        kind: "planning" as const,
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "",
        dependsOn: [],
        status: "pending" as const,
      },
      {
        id: taskNodeId,
        title: "Phase 1 Task",
        description: "Do work",
        kind: "raw" as const,
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "",
        dependsOn: [plannerNodeId],
        status: "pending" as const,
      },
    ],
    phases: [
      {
        id: phaseId,
        ordinal: 0 as number & { readonly NonNegativeInt: unique symbol },
        title: "Phase 1: Core",
        description: "",
        approval: "pending" as const,
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: NOW_ISO,
    compiledBy: "planner" as const,
  };
  const projection: WeaveRunProjection = {
    run: {
      id: WEAVE_RUN_ID,
      projectId: PROJECT_ID,
      title: "test",
      vision: "test",
      status: "running",
      concurrencyCap: 1,
      createdAt: NOW_ISO,
    },
    currentBlueprint: customBlueprint,
    nodeMeta: new Map<WeaveNodeId, WeaveNodeMeta>([
      [plannerNodeId, { status: "pending" }],
      [taskNodeId, { status: "pending" }],
    ]),
    openDecisions: new Set(),
    autoDecisionLog: [],
    phaseApprovals: new Map(),
    childThreads: new Map(),
  };

  const mounted = await mountApp({
    snapshot,
    initialPath: `/${LOCAL_ENVIRONMENT_ID}/${WEAVE_RUN_ID}`,
    weaveRunProjection: projection,
  });

  try {
    // Wait for the planner node card to render.
    await vi.waitFor(
      () => {
        const cards = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
        const plannerCard = cards.find((c) => c.textContent?.includes("Phase 1 Planner"));
        expect(plannerCard, "Planner card should render").toBeTruthy();
        // Badge text "Planning" should be inside the planner card.
        expect(plannerCard?.textContent).toContain("Planning");
      },
      { timeout: 8_000, interval: 16 },
    );

    // The non-planning task card should NOT contain the badge text.
    const cards = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const taskCard = cards.find((c) => c.textContent?.includes("Phase 1 Task"));
    expect(taskCard, "Task card should render").toBeTruthy();
    expect(taskCard?.textContent ?? "").not.toContain("Planning");
  } finally {
    await mounted.cleanup();
  }
});
```

The helpers `mountApp`, `createBaseSnapshot`, `LOCAL_ENVIRONMENT_ID`, `PHASE_ID`, `WEAVE_RUN_ID`, `PROJECT_ID`, `NOW_ISO`, `WeaveRunProjection`, `WeaveNodeMeta`, `WeaveNodeId`, `BlueprintVersion` are already imported at the top of the file.

- [ ] **Step 2: Run the new test and confirm it fails**

Run from the repo root: `bun run test --filter=@t3tools/web -- src/components/weave/WeaveView.browser.tsx -t "Planning"`

Expected: FAIL — the assertion `plannerCard?.textContent.toContain("Planning")` does not find the badge text. The card renders title only.

- [ ] **Step 3: Add the kind badge to `WeaveNodeCard`**

In `apps/web/src/components/weave/WeaveNodeCard.tsx`, find the title row (around line 44–46):

```tsx
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{node.title}</div>
```

Replace with:

```tsx
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{node.title}</span>
          {node.kind === "planning" && (
            <span
              className="shrink-0 inline-block rounded border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-300"
              aria-label="Planning Node"
            >
              Planning
            </span>
          )}
        </div>
```

The wrapping `<div className="font-medium truncate">` becomes a `<span className="font-medium truncate">` inside a flex row so the badge can sit next to the title without disrupting the truncation behavior (the title still truncates; the badge stays full-width). The `shrink-0` on the badge prevents it from being squeezed when the title is long.

The cyan tone matches `WeaveApproveCallout`'s "approve" border (`bg-cyan-500/5` is already used in the callout) — visually associating the Planning kind with the planning-time gate.

- [ ] **Step 4: Run the new test and confirm it passes**

Run: `bun run test --filter=@t3tools/web -- src/components/weave/WeaveView.browser.tsx -t "Planning"`

Expected: PASS. The badge text appears inside the planner card and does not appear inside the task card.

- [ ] **Step 5: Run the full WeaveView.browser.tsx test suite and confirm no regressions**

Run: `bun run test --filter=@t3tools/web -- src/components/weave/WeaveView.browser.tsx`

Expected: every previously-passing browser test still passes. The new test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/weave/WeaveNodeCard.tsx apps/web/src/components/weave/WeaveView.browser.tsx
git commit -m "feat(weave-web): render 'Planning' badge for kind=planning nodes"
```

---

## Task 2: Multi-gate approval UX — Phase-aware callout

**Files:**

- Modify: `apps/web/src/components/weave/WeaveApproveCallout.tsx`
- Modify: `apps/web/src/components/weave/WeaveView.tsx` (pass the projection through)
- Modify: `apps/web/src/components/weave/WeaveView.browser.tsx` (append a new test for the post-emission variant)

**Why this matters:** Slice 4's server work means the run re-enters `"reviewing"` every time a Phase Planner emits — multiple times across a single run, not just at intake. The current `WeaveApproveCallout` always says "Approve & run" with the intake-time tile counts (Phases / Nodes / Contracts / Est. wall time). After a Phase emission, those tiles are misleading: the user is approving the _delta_ (new Tasks under one Phase), not the full Blueprint. The headline should also tell the user _which Phase_ they're approving so they can match it against the Blueprint list below.

The discriminator is `blueprint.compiledBy`. The available values are `"planner"`, `"amendment"`, `"redesign"`, `"phase-planning"` (per the Slice 1 / Slice 3 schema). For Slice 5:

- `"planner"`: keep current copy and tile contents (intake gate).
- `"phase-planning"`: switch to delta copy and a "new Tasks" tile.
- `"amendment"` / `"redesign"`: render a generic "Approve plan update" headline. These reasons aren't exercised today (Slice 4's run never produces them), but the Blueprint schema admits them — handle them as a catch-all so we don't crash, and revisit copy in a later slice.

To compute "which Phase just emitted" for the `phase-planning` headline, the callout needs the projection: walk `detail.nodeMeta` to find Planning Nodes whose `status === "verified"`, then take the most-recently-`verifiedAt` one — its `phaseId` is the Phase that just emitted. To compute the delta count, count `blueprint.nodes` that share that `phaseId` minus the planner node itself. This is a derived quantity — no projection state changes.

- [ ] **Step 1: Write a failing browser test for the post-emission headline**

Append at the end of `apps/web/src/components/weave/WeaveView.browser.tsx`, inside the same `describe(...)` block as Task 1's test:

```ts
// --------------------------------------------------------------------------
// Test N+1: post-Phase-Planner-emission gate shows Phase-aware headline
// --------------------------------------------------------------------------
it("renders a Phase-aware approve callout when blueprint.compiledBy is 'phase-planning'", async () => {
  const snapshot = createBaseSnapshot();
  const phaseId = PHASE_ID;
  const plannerNodeId = "phase-1-planner" as WeaveNodeId;
  const taskAId = "phase-1-task-a" as WeaveNodeId;
  const taskBId = "phase-1-task-b" as WeaveNodeId;
  const customBlueprint = {
    version: 2 as BlueprintVersion,
    nodes: [
      {
        id: plannerNodeId,
        title: "Phase 1 Planner",
        description: "Plan Phase 1",
        kind: "planning" as const,
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "",
        dependsOn: [],
        status: "pending" as const,
      },
      {
        id: taskAId,
        title: "Task A",
        description: "",
        kind: "raw" as const,
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "",
        dependsOn: [plannerNodeId],
        status: "pending" as const,
      },
      {
        id: taskBId,
        title: "Task B",
        description: "",
        kind: "raw" as const,
        phaseId,
        scope: { readSet: [], writeSet: [] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "",
        dependsOn: [plannerNodeId],
        status: "pending" as const,
      },
    ],
    phases: [
      {
        id: phaseId,
        ordinal: 0 as number & { readonly NonNegativeInt: unique symbol },
        title: "Phase 1: Core",
        description: "",
        approval: "pending" as const,
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: NOW_ISO,
    compiledBy: "phase-planning" as const,
  };
  const projection: WeaveRunProjection = {
    run: {
      id: WEAVE_RUN_ID,
      projectId: PROJECT_ID,
      title: "test",
      vision: "test",
      status: "reviewing",
      concurrencyCap: 1,
      createdAt: NOW_ISO,
    },
    currentBlueprint: customBlueprint,
    nodeMeta: new Map<WeaveNodeId, WeaveNodeMeta>([
      // The planner node is verified (it just emitted) — its `verifiedAt`
      // identifies which Phase the user is being asked to approve.
      [plannerNodeId, { status: "verified", verifiedAt: NOW_ISO }],
      [taskAId, { status: "pending" }],
      [taskBId, { status: "pending" }],
    ]),
    openDecisions: new Set(),
    autoDecisionLog: [],
    phaseApprovals: new Map(),
    childThreads: new Map(),
  };

  const mounted = await mountApp({
    snapshot,
    initialPath: `/${LOCAL_ENVIRONMENT_ID}/${WEAVE_RUN_ID}`,
    weaveRunProjection: projection,
  });

  try {
    // Headline mentions "Phase 1: Core" (the title of the just-emitted Phase).
    await vi.waitFor(
      () => {
        const callout = document.querySelector<HTMLElement>('div[class*="bg-cyan-500/5"]');
        expect(callout, "Approve callout should render").toBeTruthy();
        expect(callout?.textContent ?? "").toContain("Phase 1: Core");
        // Subhead/copy includes the count of newly-added Tasks (2: Task A and Task B).
        expect(callout?.textContent ?? "").toMatch(/2 new Tasks/i);
      },
      { timeout: 8_000, interval: 16 },
    );
  } finally {
    await mounted.cleanup();
  }
});
```

Note the projection's `nodeMeta` for the planner is `{ status: "verified", verifiedAt: NOW_ISO }`. The callout uses this to identify the Phase. The two non-planner Tasks are pending — their count (2) is the delta the user is being asked to approve.

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `bun run test --filter=@t3tools/web -- src/components/weave/WeaveView.browser.tsx -t "Phase-aware"`

Expected: FAIL — current `WeaveApproveCallout` does not branch on `compiledBy` and does not show the Phase title.

- [ ] **Step 3: Update `WeaveApproveCallout` to branch on `blueprint.compiledBy`**

Replace `apps/web/src/components/weave/WeaveApproveCallout.tsx` with:

```tsx
"use client";

import type { Blueprint, EnvironmentId, WeaveRunId, WeaveRunProjection } from "@t3tools/contracts";
import { BlueprintVersion, CommandId } from "@t3tools/contracts";
import { useEffect } from "react";
import { Button } from "../ui/button";
import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";

export interface WeaveApproveCalloutProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly blueprint: Blueprint;
  readonly detail: WeaveRunProjection;
}

interface CalloutCopy {
  readonly headline: string;
  readonly subhead: string | null;
  readonly tiles: ReadonlyArray<{ label: string; value: number | string }>;
}

/**
 * Compute the headline + tiles for the approve callout based on what kind of
 * compile the user is being asked to approve.
 *
 * - "planner": initial intake gate. Show full Blueprint counts.
 * - "phase-planning": a Phase Planner just emitted. Show that Phase's title
 *   in the headline + a delta count of newly-added Tasks.
 * - "amendment" / "redesign": catch-all "Approve plan update". Use the full
 *   Blueprint counts; future slices will refine the copy.
 */
function buildCalloutCopy(blueprint: Blueprint, detail: WeaveRunProjection): CalloutCopy {
  const phaseCount = blueprint.phases.length;
  const nodeCount = blueprint.nodes.length;
  const contractCount = blueprint.contracts?.length ?? 0;
  const estWallTime = "≈ 10–30 min"; // v0.1 placeholder per spec §4.6

  if (blueprint.compiledBy === "phase-planning") {
    // Find the most-recently-verified Planning Node — its phase is the one
    // the user is being asked to approve.
    let mostRecent: { plannerNode: (typeof blueprint.nodes)[number]; verifiedAt: string } | null =
      null;
    for (const node of blueprint.nodes) {
      if (node.kind !== "planning") continue;
      const meta = detail.nodeMeta.get(node.id);
      if (meta?.status !== "verified" || meta.verifiedAt === undefined) continue;
      if (mostRecent === null || meta.verifiedAt > mostRecent.verifiedAt) {
        mostRecent = { plannerNode: node, verifiedAt: meta.verifiedAt };
      }
    }
    if (mostRecent !== null) {
      const phase = blueprint.phases.find((p) => p.id === mostRecent.plannerNode.phaseId);
      const phaseTitle = phase?.title ?? "Phase";
      // Delta = nodes in this phase, excluding the planner itself.
      const newTaskCount = blueprint.nodes.filter(
        (n) => n.phaseId === mostRecent.plannerNode.phaseId && n.id !== mostRecent.plannerNode.id,
      ).length;
      return {
        headline: `Approve ${phaseTitle} plan`,
        subhead: `${newTaskCount} new ${newTaskCount === 1 ? "Task" : "Tasks"} added since last approval.`,
        tiles: [
          { label: "Phase", value: phaseTitle },
          { label: "New Tasks", value: newTaskCount },
          { label: "Total Phases", value: phaseCount },
          { label: "Est. wall time", value: estWallTime },
        ],
      };
    }
    // Fall through to the generic "plan update" copy if we can't identify
    // the phase (shouldn't happen — `phase-planning` always pairs with a
    // verified planner node — but this keeps the UI safe).
  }

  if (blueprint.compiledBy === "amendment" || blueprint.compiledBy === "redesign") {
    return {
      headline: "Approve plan update",
      subhead: null,
      tiles: [
        { label: "Phases", value: phaseCount },
        { label: "Nodes", value: nodeCount },
        { label: "Contracts", value: contractCount },
        { label: "Est. wall time", value: estWallTime },
      ],
    };
  }

  // Default: "planner" (initial compile).
  return {
    headline: "Approve & run",
    subhead: null,
    tiles: [
      { label: "Phases", value: phaseCount },
      { label: "Nodes", value: nodeCount },
      { label: "Contracts", value: contractCount },
      { label: "Est. wall time", value: estWallTime },
    ],
  };
}

export function WeaveApproveCallout({
  environmentId,
  weaveRunId,
  blueprint,
  detail,
}: WeaveApproveCalloutProps) {
  const copy = buildCalloutCopy(blueprint, detail);

  const handleApprove = async () => {
    await dispatchWeaveCommand(environmentId, {
      type: "weave.blueprint.approve",
      commandId: CommandId.make(crypto.randomUUID()),
      weaveRunId,
      blueprintVersion: BlueprintVersion.make(blueprint.version),
      concurrencyCap: 1, // v0.1 locked
      createdAt: new Date().toISOString(),
    });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleApprove();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleApprove]);

  return (
    <div className="px-6 py-4 border-b border-border bg-cyan-500/5">
      <div className="mb-3">
        <h2 className="text-base font-semibold">{copy.headline}</h2>
        {copy.subhead !== null && (
          <p className="text-sm text-muted-foreground mt-1">{copy.subhead}</p>
        )}
      </div>
      <div className="grid grid-cols-4 gap-4 mb-4">
        {copy.tiles.map((tile) => (
          <Tile key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </div>
      <div className="flex gap-3">
        <Button onClick={() => void handleApprove()}>Approve & run (⌘↵)</Button>
        <Button variant="outline" disabled title="Direct-edit ships in v0.3">
          Edit Blueprint
        </Button>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center p-3 bg-background rounded border border-border">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
```

Three substantive changes from the prior file:

1. New `WeaveApproveCalloutProps.detail` field (the projection).
2. New `buildCalloutCopy(blueprint, detail)` helper that switches on `blueprint.compiledBy`.
3. New `<h2>` headline + optional `<p>` subhead above the Tile row.

The dispatch path, keyboard shortcut, and "Edit Blueprint" disabled button are unchanged from the previous version.

- [ ] **Step 4: Update `WeaveView.tsx` to pass `detail` into the callout**

In `apps/web/src/components/weave/WeaveView.tsx`, find the `<WeaveApproveCallout ... />` invocation (around lines 70–74):

```tsx
<WeaveApproveCallout
  environmentId={props.environmentId}
  weaveRunId={shell.id}
  blueprint={blueprint}
/>
```

Add the `detail` prop (the projection is already in scope as `detail`, and the `blueprint && shell.status === "reviewing"` guard above ensures `detail` is non-null when the callout renders):

```tsx
<WeaveApproveCallout
  environmentId={props.environmentId}
  weaveRunId={shell.id}
  blueprint={blueprint}
  detail={detail!}
/>
```

The `detail!` non-null assertion matches the existing pattern at the next line (`<WeaveBlueprintList detail={detail!} ... />`) — `detail` is non-null inside the same conditional branch.

- [ ] **Step 5: Run the new test and confirm it passes**

Run: `bun run test --filter=@t3tools/web -- src/components/weave/WeaveView.browser.tsx -t "Phase-aware"`

Expected: PASS. The callout's headline contains "Phase 1: Core" and the subhead text matches `/2 new Tasks/i`.

- [ ] **Step 6: Run the full WeaveView.browser.tsx test suite and confirm no regressions**

Run: `bun run test --filter=@t3tools/web -- src/components/weave/WeaveView.browser.tsx`

Expected: every previously-passing browser test still passes (in particular, the existing intake-gate test that asserts the "Phases / Nodes / Contracts / Est. wall time" tiles — those tiles are still rendered for `compiledBy: "planner"` blueprints).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/weave/WeaveApproveCallout.tsx apps/web/src/components/weave/WeaveView.tsx apps/web/src/components/weave/WeaveView.browser.tsx
git commit -m "feat(weave-web): approve callout adapts copy + tiles to blueprint.compiledBy"
```

---

## Task 3: Test fixture cleanup — `makeMinimalBlueprint` helper

**Files:**

- Modify: `apps/server/src/orchestration/weaveProjector.test.ts` (add helper near top-of-file test helpers; refactor the two Slice 4 Task 1 tests to use it)

**Why this matters:** The Slice 4 Task 1 reviewer flagged ([slice 4 plan, code-review notes inline]):

> Test fixture duplication in `weaveProjector.test.ts:614-770`. The two new tests rebuild full `Blueprint` literals inline (~70 lines of boilerplate per node, with empty `scope`, contracts, etc.). The plan prescribes this verbatim, so the implementer didn't deviate — but the file now has a third copy of "minimal Blueprint with one node" patterns. A `makeMinimalBlueprint({ nodes, version })` helper near `weaveEvent` would shrink the new block by ~80 lines and make future projector tests cheaper to add.

A small, well-typed helper near the existing `weaveEvent` helper retires the duplication without changing test semantics. Net line delta is negative; future projector tests benefit too.

Scope discipline: this task migrates **only** the two `nodeMeta`-preservation tests (`describe("projectWeaveEvent — weave.blueprint-compiled (nodeMeta preservation)", ...)`) added in Slice 4 Task 1. Other tests in `weaveProjector.test.ts` (from Slices 1-3) are NOT migrated — that's a separate cleanup pass beyond Slice 5's scope. If a future slice needs more migration, the helper is in place.

- [ ] **Step 1: Locate the existing test helpers and confirm the import surface**

Read the top of `apps/server/src/orchestration/weaveProjector.test.ts` (lines 1–60 are sufficient). Confirm:

- `Schema` is imported from `effect`.
- `Blueprint`, `BlueprintVersion`, `WeaveNodeId`, `WeavePhaseId`, `BlueprintSource` (or whichever subset is needed) are imported from `@t3tools/contracts`.
- `now` (an ISO string constant used by the existing tests) is defined.
- The existing `weaveEvent(...)` helper is the natural co-location for the new helper.

If `BlueprintSource` is not yet imported, add it to the existing `@t3tools/contracts` import.

- [ ] **Step 2: Add the `makeMinimalBlueprint` helper near the existing `weaveEvent` helper**

Append the following helper immediately after the existing `weaveEvent` helper definition (or near the top-of-file helpers — match the file's existing structure):

```ts
/**
 * Build a minimal Blueprint for projector tests.
 *
 * Defaults:
 *  - `version`: required (callers always specify it).
 *  - `compiledBy`: "planner" if not provided.
 *  - Each node: `description` "", empty `scope`/contracts, empty
 *    `verifierDescription`, status "pending".
 *  - One phase ("p1", ordinal 0) if `phases` is omitted.
 *
 * Decode is via `Schema.decodeSync(Blueprint)` so the result is the same
 * branded-typed shape the production code returns.
 */
type NodeOpts = {
  id: string;
  kind?: "raw" | "scaffold" | "contract" | "utility" | "planning";
  phaseId?: string;
  dependsOn?: ReadonlyArray<string>;
  title?: string;
};
type PhaseOpts = { id: string; ordinal: number; title?: string };

function makeMinimalBlueprint(opts: {
  version: number;
  nodes: ReadonlyArray<NodeOpts>;
  phases?: ReadonlyArray<PhaseOpts>;
  compiledBy?: BlueprintSource;
}): Blueprint {
  const phases = opts.phases ?? [{ id: "p1", ordinal: 0 }];
  return Schema.decodeSync(Blueprint)({
    version: BlueprintVersion.make(opts.version),
    nodes: opts.nodes.map((n) => ({
      id: WeaveNodeId.make(n.id),
      title: n.title ?? n.id,
      description: "",
      kind: n.kind ?? "raw",
      phaseId: WeavePhaseId.make(n.phaseId ?? phases[0]!.id),
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: (n.dependsOn ?? []).map((d) => WeaveNodeId.make(d)),
      status: "pending",
    })),
    phases: phases.map((p) => ({
      id: WeavePhaseId.make(p.id),
      ordinal: p.ordinal,
      title: p.title ?? p.id,
      description: "",
      approval: "pending",
    })),
    contracts: [],
    decisions: [],
    compiledAt: now,
    compiledBy: opts.compiledBy ?? "planner",
  });
}
```

If `BlueprintSource` isn't already imported, add it to the existing `@t3tools/contracts` import line.

- [ ] **Step 3: Migrate the first preservation test to use the helper**

Find the first test inside `describe("projectWeaveEvent — weave.blueprint-compiled (nodeMeta preservation)", ...)`: the one named `"preserves prior verified status when a node survives into a new Blueprint version"`.

Replace its `Schema.decodeSync(Blueprint)({ ... })` v1 block with:

```ts
const v1 = makeMinimalBlueprint({
  version: 1,
  nodes: [{ id: "n1", kind: "planning" }],
});
```

Replace its v2 block with:

```ts
const v2 = makeMinimalBlueprint({
  version: 2,
  compiledBy: "phase-planning",
  nodes: [
    { id: "n1", kind: "planning" },
    { id: "n2", kind: "raw", dependsOn: ["n1"] },
  ],
});
```

The phases and other fields are inferred from the helper's defaults. The behavior the test asserts — `nodeMeta.get("n1").status === "verified"` after applying compileV2 to the post-verified state — is unchanged.

- [ ] **Step 4: Migrate the second preservation test to use the helper**

Find the second test in the same describe block: `"seeds 'pending' for every node on the very first compile (state.nodeMeta empty)"`.

Replace its `Schema.decodeSync(Blueprint)({ ... })` v1 block with:

```ts
const v1 = makeMinimalBlueprint({
  version: 1,
  nodes: [
    { id: "a", kind: "raw" },
    { id: "b", kind: "raw" },
  ],
});
```

The behavior the test asserts — both nodes seed `pending` after the initial compile — is unchanged.

- [ ] **Step 5: Run the projector tests and confirm they all pass**

Run: `cd /Users/nikrabaev/Work/oss/t3code/apps/server && bun run test src/orchestration/weaveProjector.test.ts`

Expected: every test passes. Specifically the two migrated tests (`preserves prior verified status…` and `seeds 'pending' for every node…`) pass with identical assertion outcomes to before the refactor. The total test count is unchanged.

- [ ] **Step 6: Verify net line count is negative**

Run: `git diff --stat apps/server/src/orchestration/weaveProjector.test.ts`

Expected: more lines removed than added. The helper itself adds ~50 lines, but each migrated literal shrinks by ~70 lines, net is negative across both tests.

If the line count is positive (helper too verbose, or migration didn't actually replace the literals), pause and report — something didn't apply correctly.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/orchestration/weaveProjector.test.ts
git commit -m "refactor(weave): extract makeMinimalBlueprint helper in weaveProjector tests"
```

---

## Task 4: Whole-repo verification

**Files:** No file changes expected. Verification only; if any guard fixes are needed, they get a separate commit.

- [ ] **Step 1: Repo-wide typecheck**

Run from the repo root: `bun typecheck`

Expected: PASS for all 10 packages. Pre-existing plugin lint messages (`message TS29`, `message TS44`, `message TS15` in `PlannerDriver.ts`, `WeaveContractConformer.ts`, `weaveDecider.ts`, etc.) are messages, not errors — acceptable.

If the new `WeaveApproveCalloutProps.detail` type breaks any other call site (e.g., a Storybook entry, a snapshot test, a re-export), that's the most likely place for a typecheck failure. The only known call site of `WeaveApproveCallout` is `WeaveView.tsx`, which is updated in Task 2 Step 4. Search for other call sites if a break appears: `grep -rn "WeaveApproveCallout" apps/web/src/`.

- [ ] **Step 2: Repo-wide tests**

Run from the repo root: `bun run test`

Expected baseline shift relative to Slice 4:

- Slice 4 actual: 1033 passed / 4 skipped / 7 failed.
- Slice 5 expected: ≥1035 passed / 4 skipped / 7 failed. Breakdown:
  - **+2 new passing browser tests** from Tasks 1 and 2 (kind badge + Phase-aware headline).
  - **+0 from Task 3** — the test-fixture refactor migrates two existing tests (same count, same assertions).
  - The 7 failures stay GitManager network-timeout family.

If any non-GitManager test fails, treat as a regression and STOP. The most likely Slice-5-introduced regression is a different `WeaveView.browser.tsx` test that asserts the previous callout copy ("Phases / Nodes / Contracts / Est. wall time" tiles in the intake-gate test). If that fails, double-check Task 2 Step 3: the `compiledBy === "planner"` branch still emits the same four tile labels.

- [ ] **Step 3: Lint and format**

Run from the repo root: `bun lint && bun fmt`

Expected: lint passes (warnings are pre-existing and acceptable; errors are not). `bun fmt` may reformat files this slice touched — accept those.

If `bun fmt` reformats files OUTSIDE this slice's scope (i.e., docs files, other packages' source not modified by Tasks 1–3, files unrelated to weave), do NOT include them. Revert with `git checkout -- <path>`.

- [ ] **Step 4: Commit any guard fixes (only if needed)**

If `bun fmt` reformatted any in-scope files, stage and commit them as:

```bash
git add <files>
git commit -m "style(weave): apply bun fmt to slice 5 files"
```

If no fmt fixups were needed, skip this step. Slice 5 ends with the three task commits from Tasks 1–3.

---

## Self-review checklist

Run through this once Task 4 is done.

- **Spec coverage.** Every Slice 5 deliverable from the design doc maps to a task here:
  - "WeaveBlueprintList renders Planning Nodes inline with Tasks (kind badge planning)" → Task 1.
  - "Approve flow surfaces at each Phase boundary, not only at intake" → Task 2 (the existing `shell.status === "reviewing"` predicate already re-fires; Task 2 makes the rendering Phase-aware).
  - Slice 4 Task 1 reviewer follow-up (test fixture cleanup) → Task 3.
  - Whole-repo gates → Task 4.
  - Edit Vision / Re-plan Phase / Abort buttons: explicitly out of scope; documented in "Out of scope for Slice 5."

- **No placeholder language.** No `TBD`, `TODO`, "implement later," or vague "add validation"-style steps.

- **Type consistency.** Field names, helper names, and signatures match between tasks:
  - `Blueprint.compiledBy: BlueprintSource` (with literals `"planner" | "amendment" | "redesign" | "phase-planning"`) is the discriminator in Task 2.
  - `WeaveRunProjection.nodeMeta: ReadonlyMap<WeaveNodeId, WeaveNodeMeta>` and `WeaveNodeMeta.verifiedAt: Schema.optional(IsoDateTime)` are the fields the callout reads in Task 2.
  - `makeMinimalBlueprint` (Task 3) takes `{ version: number; nodes: ReadonlyArray<NodeOpts>; phases?: ReadonlyArray<PhaseOpts>; compiledBy?: BlueprintSource }`.
  - The browser tests in Task 1 and Task 2 reuse the existing `mountApp` / `createBaseSnapshot` / `WEAVE_RUN_ID` / `LOCAL_ENVIRONMENT_ID` helpers from `WeaveView.browser.tsx`.

- **Out-of-scope hold.** Slice 5 does NOT modify any server reactor, decider, projector, or contract. The conformer source is NOT touched. The decider source is NOT touched. The `WeavePlanner → MetaPlanner` rename is NOT performed. Edit Vision / Re-plan Phase server commands are NOT introduced. Mid-Phase Planning Node user gates are NOT introduced.

- **Commit hygiene.** Three small commits for Tasks 1–3, plus optionally a fourth from Task 4 if `bun fmt` had to reformat any in-scope files.

---

## What ships at end of Slice 5

The user can drive an incremental-planning Run end-to-end through the web UI. At intake, they see "Approve & run" with the meta-Blueprint summary (N Phases, N Planning Nodes, ...). After approving, the run starts and Phase 1's Planning Node dispatches. When that planner emits its sub-DAG, the callout reappears with "Approve Phase 1: Core plan — N new Tasks" and the user clicks Approve & run again. The cycle repeats per Phase boundary until the run is `complete`. Throughout, Planning Nodes are visually distinguished from Tasks in the Blueprint list.

Two pieces remain before the feature is fully production-ready, both deferred:

1. **Edit Vision and Re-plan Phase actions.** These need server commands (re-run the meta-planner with an updated Vision; re-dispatch a Planning Node with a rejection rationale) plus matching UI. A follow-up slice will own both.
2. **Live `PhasePlannerDriver` Layer.** Production wiring of an LLM for the Phase Planner agent. Slice 4's integration test injects assistant messages by hand; production needs a real provider Layer.

Neither blocks Slice 5's deliverable: the user-visible flow now matches the design's user-facing lifecycle (approve at each Phase boundary, see the new plan emerge).
