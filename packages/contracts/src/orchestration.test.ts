import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  AggregateRef,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_KIND,
  OrchestrationAggregateKind,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationThread,
  OrchestrationThreadShell,
  OrchestrationWeaveRunShell,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationSession,
  ProjectCreateCommand,
  ProviderInteractionMode,
  ThreadMetaUpdatedPayload,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
} from "./orchestration.ts";
import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { WeaveRunId } from "./weave.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProviderInteractionMode = Schema.decodeUnknownEffect(ProviderInteractionMode);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects thread turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeThreadTurnDiff({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      provider: "codex",
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      verifierCommand: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.provider, "codex");
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.provider, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("accepts bootstrap metadata in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-bootstrap",
      threadId: "thread-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "Bootstrap thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "t3code/example",
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createThread?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.provider, "codex");
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "claudeAgent");
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.strictEqual(archived.type, "thread.archived");
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: {
          reasoningEffort: "high",
          fastMode: true,
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "codex");
    assert.strictEqual(parsed.modelSelection?.options?.reasoningEffort, "high");
    assert.strictEqual(parsed.modelSelection?.options?.fastMode, true);
  }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);

it.effect("accepts 'weave' as a provider interaction mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProviderInteractionMode("weave");
    assert.strictEqual(parsed, "weave");
  }),
);

const decodeOrchestrationAggregateKind = Schema.decodeUnknownEffect(OrchestrationAggregateKind);

it.effect("accepts 'weave' as an orchestration aggregate kind", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationAggregateKind("weave");
    assert.strictEqual(parsed, "weave");
  }),
);

it.effect("decodes a weave.created event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-w1",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.created",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: "cmd-1",
      causationEventId: null,
      correlationId: "cmd-1",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        projectId: "project-1",
        title: "Add blog",
        vision: "# Goal",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.created");
    assert.strictEqual(event.aggregateKind, "weave");
    if (event.type === "weave.created") {
      assert.strictEqual(event.payload.weaveRunId, "run-1");
    }
  }),
);

it.effect("decodes a weave.blueprint-approved event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-w2",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.blueprint-approved",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: "cmd-2",
      causationEventId: null,
      correlationId: "cmd-2",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        version: 1,
        concurrencyCap: 1,
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.blueprint-approved");
    if (event.type === "weave.blueprint-approved") {
      assert.strictEqual(event.payload.concurrencyCap, 1);
    }
  }),
);

it.effect("decodes a weave.exited event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 3,
      eventId: "event-w3",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.exited",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: "cmd-3",
      causationEventId: null,
      correlationId: "cmd-3",
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        reason: "complete",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.exited");
    if (event.type === "weave.exited") {
      assert.strictEqual(event.payload.reason, "complete");
    }
  }),
);

it.effect("decodes weave.create via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "weave.create",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "Add blog",
      vision: "",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.create");
  }),
);

it.effect("decodes weave.blueprint.compile (internal) via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "weave.blueprint.compile",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      reason: "initial",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.compile");
  }),
);

it.effect("decodes weave.exit via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "weave.exit",
      commandId: "cmd-3",
      weaveRunId: "run-1",
      reason: "complete",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.exit");
  }),
);

// Union-dispatch coverage for the remaining six weave event variants
// (weave.created, weave.blueprint-approved, weave.exited are already
// covered above; these tests round out OrchestrationEvent's discrimination
// over the full weave event namespace).
it.effect("decodes weave.blueprint-compiled event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 10,
      eventId: "event-w-bc",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.blueprint-compiled",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        version: 1,
        blueprint: {
          version: 1,
          nodes: [],
          phases: [],
          contracts: [],
          decisions: [],
          compiledAt: "2026-04-21T00:00:00.000Z",
          compiledBy: "planner",
        },
        compiledBy: "planner",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.blueprint-compiled");
  }),
);

it.effect("decodes weave.node-dispatched event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 11,
      eventId: "event-w-nd",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.node-dispatched",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        nodeId: "node-1",
        childThreadId: "thread-1",
        worktreePath: "/tmp/wt",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.node-dispatched");
  }),
);

it.effect("decodes weave.node-verified event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 12,
      eventId: "event-w-nv",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.node-verified",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        nodeId: "node-1",
        verifierOutcome: "tests-passed",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.node-verified");
  }),
);

it.effect("decodes weave.node-failed event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 13,
      eventId: "event-w-nf",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.node-failed",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        nodeId: "node-1",
        reason: "x",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.node-failed");
  }),
);

it.effect("decodes weave.decision-resolved event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 14,
      eventId: "event-w-dr",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.decision-resolved",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        decisionId: "decision-1",
        answer: "a",
        byUser: false,
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.decision-resolved");
  }),
);

it.effect("decodes weave.phase-approved event via OrchestrationEvent", () =>
  Effect.gen(function* () {
    const event = yield* decodeOrchestrationEvent({
      sequence: 15,
      eventId: "event-w-pa",
      aggregateKind: "weave",
      aggregateId: "run-1",
      type: "weave.phase-approved",
      occurredAt: "2026-04-21T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        weaveRunId: "run-1",
        phaseId: "phase-1",
        approval: "approved",
        occurredAt: "2026-04-21T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "weave.phase-approved");
  }),
);

// AggregateRef round-trip tests.
// Brands are compile-time-only; at runtime all three variants are structurally
// plain strings, so the union decoder accepts whichever literal "aggregateKind"
// matches and does not re-validate the string brand on "aggregateId".

it("decodes a project AggregateRef and narrows aggregateId to ProjectId", () => {
  const decoded = Schema.decodeSync(AggregateRef)({
    aggregateKind: "project",
    aggregateId: ProjectId.make("project-1"),
  });
  assert.strictEqual(decoded.aggregateKind, "project");
  assert.strictEqual(decoded.aggregateId, ProjectId.make("project-1"));
});

it("decodes a thread AggregateRef and narrows aggregateId to ThreadId", () => {
  const decoded = Schema.decodeSync(AggregateRef)({
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
  });
  assert.strictEqual(decoded.aggregateKind, "thread");
  assert.strictEqual(decoded.aggregateId, ThreadId.make("thread-1"));
});

it("decodes a weave AggregateRef and narrows aggregateId to WeaveRunId", () => {
  const decoded = Schema.decodeSync(AggregateRef)({
    aggregateKind: "weave",
    aggregateId: WeaveRunId.make("run-1"),
  });
  assert.strictEqual(decoded.aggregateKind, "weave");
  assert.strictEqual(decoded.aggregateId, WeaveRunId.make("run-1"));
});

it("documents that AggregateRef brand enforcement is compile-time only (runtime accepts mismatched brands)", () => {
  // Runtime Schema.decode accepts any structurally-string aggregateId because
  // brands are erased. Kind-specific aggregateId runtime validation is deferred.
  const decoded = Schema.decodeSync(AggregateRef)({
    aggregateKind: "project",
    aggregateId: ThreadId.make("thread-1"), // structurally a string at runtime
  });
  assert.strictEqual(decoded.aggregateKind, "project");
});

// OrchestrationReadModel.weaveRuns round-trip test.
// Schema.ReadonlyMap encodes as ReadonlyArray<readonly [key, value]>, so an
// empty map encodes as [] and decodes back to an empty ReadonlyMap.
it.effect("decodes OrchestrationReadModel with empty weaveRuns", () =>
  Effect.gen(function* () {
    const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
    const now = "2026-04-24T00:00:00.000Z";
    const decoded = yield* decodeReadModel({
      snapshotSequence: 0,
      projects: [],
      threads: [],
      weaveRuns: new Map(),
      updatedAt: now,
    });
    assert.strictEqual(decoded.snapshotSequence, 0);
    assert.strictEqual(decoded.weaveRuns.size, 0);
    assert.strictEqual(decoded.updatedAt, now);
  }),
);

const decodeOrchestrationWeaveRunShell = Schema.decodeUnknownEffect(OrchestrationWeaveRunShell);
const decodeOrchestrationShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
const decodeOrchestrationShellStreamEvent = Schema.decodeUnknownEffect(
  OrchestrationShellStreamEvent,
);

it.effect("OrchestrationWeaveRunShell decodes a summary round-trip", () =>
  Effect.gen(function* () {
    const now = "2026-04-24T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationWeaveRunShell({
      id: "run-1",
      projectId: "proj-1",
      title: "Ship login",
      status: "reviewing",
      pendingCount: 3,
      readyCount: 0,
      runningCount: 0,
      verifiedCount: 0,
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    assert.strictEqual(decoded.status, "reviewing");
    assert.strictEqual(decoded.pendingCount, 3);
  }),
);

it.effect("OrchestrationShellSnapshot decodes with empty weaveRuns", () =>
  Effect.gen(function* () {
    const now = "2026-04-24T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationShellSnapshot({
      snapshotSequence: 0,
      projects: [],
      threads: [],
      weaveRuns: [],
      updatedAt: now,
    });
    assert.strictEqual(decoded.weaveRuns.length, 0);
  }),
);

it.effect("OrchestrationShellStreamEvent decodes weave-run-upserted", () =>
  Effect.gen(function* () {
    const now = "2026-04-24T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationShellStreamEvent({
      kind: "weave-run-upserted",
      sequence: 1,
      weaveRun: {
        id: "run-1",
        projectId: "proj-1",
        title: "Ship",
        status: "draft",
        pendingCount: 0,
        readyCount: 0,
        runningCount: 0,
        verifiedCount: 0,
        failedCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    assert.strictEqual(decoded.kind, "weave-run-upserted");
  }),
);

it.effect("OrchestrationShellStreamEvent decodes weave-run-removed", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeOrchestrationShellStreamEvent({
      kind: "weave-run-removed",
      sequence: 2,
      weaveRunId: "run-1",
    });
    assert.strictEqual(decoded.kind, "weave-run-removed");
  }),
);

const decodeOrchestrationThread = Schema.decodeUnknownEffect(OrchestrationThread);

it.effect("OrchestrationThread defaults kind to 'chat' when omitted", () =>
  Effect.gen(function* () {
    const now = "2026-04-25T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Test thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    });
    assert.strictEqual(decoded.kind, DEFAULT_THREAD_KIND);
    assert.strictEqual(decoded.kind, "chat");
  }),
);

it.effect("OrchestrationThread round-trips kind: 'planner'", () =>
  Effect.gen(function* () {
    const now = "2026-04-25T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationThread({
      id: "thread-2",
      projectId: "project-1",
      title: "Planner thread",
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
      runtimeMode: "full-access",
      kind: "planner",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    });
    assert.strictEqual(decoded.kind, "planner");
  }),
);

const decodeOrchestrationThreadShell = Schema.decodeUnknownEffect(OrchestrationThreadShell);

it.effect("OrchestrationThreadShell defaults kind to 'chat' when omitted", () =>
  Effect.gen(function* () {
    const now = "2026-04-25T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationThreadShell({
      id: "thread-1",
      projectId: "project-1",
      title: "Test thread shell",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    });
    assert.strictEqual(decoded.kind, DEFAULT_THREAD_KIND);
    assert.strictEqual(decoded.kind, "chat");
  }),
);

it.effect("OrchestrationThreadShell round-trips kind: 'planner'", () =>
  Effect.gen(function* () {
    const now = "2026-04-25T00:00:00.000Z";
    const decoded = yield* decodeOrchestrationThreadShell({
      id: "thread-2",
      projectId: "project-1",
      title: "Planner thread shell",
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
      runtimeMode: "full-access",
      kind: "planner",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    });
    assert.strictEqual(decoded.kind, "planner");
  }),
);
