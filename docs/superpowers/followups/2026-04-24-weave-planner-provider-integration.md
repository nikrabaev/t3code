# Followup: Wire WeavePlanner to ProviderService

**Filed:** 2026-04-24
**Context:** Slice 3, Task 7 — WeavePlanner is implemented with a `PlannerDriver` abstraction.

## Gap

The `WeavePlannerLive` layer depends on `PlannerDriver`. The default `PlannerDriverLive` layer
(in `apps/server/src/orchestration/Layers/PlannerDriver.ts`) is a placeholder that always fails
with `"not integrated with ProviderService yet — Slice 4"`.

All Task 7 tests inject a stub driver via `Layer.succeed(PlannerDriver, ...)` and bypass
`PlannerDriverLive` entirely. The planner logic is exercised end-to-end (compile → decode →
persist → project); only the concrete LLM call is stubbed.

## What needs to happen in Slice 4

1. **Dedicated planner thread or synthetic invocation.** `ProviderService.sendTurn` requires a
   `threadId` initialized via `startSession`. The weave aggregate has no dedicated thread. Options:
   - Synthesize a short-lived "planner session" tied to the `WeaveRunId`, start a session, send
     one turn (the planning prompt), collect the streamed output, and stop the session.
   - Alternatively, use a lower-level provider adapter call that does not require a full session.

2. **Planner prompt construction.** Build a structured prompt from `vision` + `snapshotContent`
   that instructs the model to output a JSON `Blueprint` matching the contract schema.

3. **Output extraction.** The provider may stream partial JSON; the driver must accumulate the
   full response before attempting `JSON.parse`.

4. **Wire `PlannerDriverLive` to `ProviderService`.** Replace the placeholder implementation in
   `Layers/PlannerDriver.ts` with the real one. The `PlannerDriver` service interface in
   `Services/PlannerDriver.ts` already defines the correct shape — no contract changes needed.

## Deferred to

Slice 4.

## Resolution

Resolved 2026-04-25 in plan
[`docs/superpowers/plans/2026-04-25-weave-planner-provider-integration.md`](../plans/2026-04-25-weave-planner-provider-integration.md).
Tag: `weave-v0.1-planner-integrated`.

Implementation:
- `ThreadKind = "chat" | "planner"` added to `OrchestrationThread` /
  `OrchestrationThreadShell`; `kind` column on `projection_threads` (migration 026).
- New `weave.planner.thread-created` domain event; projector materialises a hidden
  `kind: "planner"` thread row keyed off `weaveRunId`.
- Sidebar / CommandPalette filter out `kind === "planner"` threads.
- `ServerSettings.weave.planner.{provider, modelSelection}` — defaults to `claudeAgent`
  with the project's default Claude model.
- `PlannerDriverLive` now: dispatches the synthetic-thread event, calls
  `ProviderService.startSession` / `sendTurn`, accumulates `content.delta`
  payloads until `turn.completed` / `turn.aborted`, stops the session via
  `Effect.ensuring`, returns the raw JSON for `WeavePlanner` to decode.
- `PlannerDriver.compile` input extended with `weaveRunId`, `projectId`,
  `parentThreadTitle`, `projectWorkspaceRoot` (recommendation 4.4a).
- `PlannerDriverPlaceholderLive` retained for non-server contexts (CLI tools).
