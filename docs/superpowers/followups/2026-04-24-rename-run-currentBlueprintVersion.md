# Followup: rename `WeaveRun.currentBlueprintVersion` to `approvedBlueprintVersion`

**Filed:** 2026-04-24, during Slice 2 execution.
**Scope:** contracts + apps/server + any consumers once web UI lands in Slice 4.

## Why

The name `currentBlueprintVersion` reads as "the version of the blueprint the run is operating against right now." It is not that. Per [v0.1-spec.md §2.4](../../weave/v0.1-spec.md#24-projector-cases) only the `weave.blueprint-approved` event writes this field; `weave.blueprint-compiled` leaves it untouched. It means "the version most recently approved."

This naming confusion caused a real bug during Slice 2:

- The Slice 2 plan's `requireBlueprintVersion` invariant ([plan, Step 1.2](../plans/2026-04-22-weave-v01-slice-2-decider-projector.md)) compared `projection.run.currentBlueprintVersion === command.version` for `weave.blueprint.approve`.
- But on first approve, no event has yet written that field, so it is `undefined`, so the strict-equality check always fails.
- The plan-specified invariant was unreachable in the production path. Only test fixtures that hand-set the field masked the defect.
- The Slice 2 roundtrip test ([weaveRoundtrip.test.ts](../../../apps/server/src/orchestration/weaveRoundtrip.test.ts)) surfaced it and the fix landed mid-slice: the invariant now reads `projection.currentBlueprint?.version` instead.

After the fix, the run's `currentBlueprintVersion` is still genuinely useful — it encodes the last-approved version, distinct from the in-review compiled version. But a reader cannot tell that from the name.

## Rename

- `WeaveRun.currentBlueprintVersion` → `WeaveRun.approvedBlueprintVersion` in [packages/contracts/src/weave.ts](../../../packages/contracts/src/weave.ts).
- Update the projector for `weave.blueprint-approved` in [apps/server/src/orchestration/weaveProjector.ts](../../../apps/server/src/orchestration/weaveProjector.ts) to write the renamed field.
- Update `v0.1-spec.md §1.5` struct schema, `§2.4` projector table, and any prose that mentions the old name.
- Update Slice 1 tests in [packages/contracts/src/weave.test.ts](../../../packages/contracts/src/weave.test.ts) that reference the field.
- Search the web (Slice 4) work-in-progress for the old name and update. At time of filing Slice 4 has not started, so this should be a zero-diff for the web layer.

## Why not in Slice 2

Slice 2's scope is "pure decider + projector, no contracts changes, no existing-file edits outside the three new files" per the plan's spec-mandated scope. Renaming a contracts field is a Slice 1 amendment and propagates through contracts tests. Filing here instead and keeping Slice 2 focused.

## When to pick up

Ideal window: before Slice 3 begins (Slice 3 wires the pure functions into the engine and scheduler; easier to rename before a wave of new call sites lands). A single 30-minute refactor; no behavior change.

## Acceptance

- Field renamed everywhere.
- `bun typecheck` clean repo-wide.
- `bun run test` green repo-wide.
- The invariant `requireBlueprintVersion` still reads `projection.currentBlueprint?.version` (unchanged by this rename — the rename is orthogonal to the Fix B semantic change that already landed).
