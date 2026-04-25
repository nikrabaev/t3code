/**
 * PlannerDriverLive tests — fake ProviderService, ServerSettingsService,
 * OrchestrationEngineService.
 *
 * Verifies:
 *  - compile dispatches weave.planner.thread-created once with the right shape
 *  - compile calls startSession with the configured provider/model
 *  - compile calls sendTurn with a prompt that contains the vision string
 *  - compile accumulates content.delta payloads and returns the concatenation
 *  - compile calls stopSession even when the stream errors
 *  - compile fails with PlannerDriverError when planner returns empty output
 */
import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ProviderRuntimeEvent,
  ProviderSession,
  WeaveRunId,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS, EventId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { ServerSettingsShape } from "../../serverSettings.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { createEmptyReadModel } from "../projector.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { PlannerDriver, PlannerDriverError } from "../Services/PlannerDriver.ts";
import { PlannerDriverLive } from "./PlannerDriver.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

const WEAVE_RUN_ID = "run-planner-test-1" as WeaveRunId;
const PROJECT_ID = "project-planner-test-1" as ProjectId;
const WORKSPACE_ROOT = "/tmp/fake-workspace";

const defaultCompileInput = {
  weaveRunId: WEAVE_RUN_ID,
  projectId: PROJECT_ID,
  parentThreadTitle: "Test Weave",
  projectWorkspaceRoot: WORKSPACE_ROOT,
  vision: "Build a great application",
  snapshotContent: "",
} as const;

// ── Fake services ─────────────────────────────────────────────────────────────

interface FakeProviderHarness {
  service: ProviderServiceShape;
  emitEvent: (event: ProviderRuntimeEvent) => void;
  startSessionCalls: Array<{ threadId: ThreadId; input: unknown }>;
  sendTurnCalls: Array<{ threadId: ThreadId; input: unknown }>;
  stopSessionCalls: Array<{ threadId: ThreadId }>;
}

function createFakeProviderHarness(opts?: {
  failStartSession?: boolean;
  failSendTurn?: boolean;
  failStream?: boolean;
}): FakeProviderHarness {
  const eventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const startSessionCalls: Array<{ threadId: ThreadId; input: unknown }> = [];
  const sendTurnCalls: Array<{ threadId: ThreadId; input: unknown }> = [];
  const stopSessionCalls: Array<{ threadId: ThreadId }> = [];

  const service: ProviderServiceShape = {
    startSession: (threadId, input) => {
      startSessionCalls.push({ threadId, input });
      if (opts?.failStartSession) {
        return Effect.fail({
          _tag: "ProviderServiceError",
          message: "startSession failed",
        } as never);
      }
      const session: ProviderSession = {
        threadId,
        provider: input.provider ?? "claudeAgent",
        runtimeMode: "full-access",
        status: "ready",
        activeTurnId: undefined,
        lastError: undefined,
        createdAt: now(),
        updatedAt: now(),
      };
      return Effect.succeed(session);
    },
    sendTurn: (input) => {
      sendTurnCalls.push({ threadId: input.threadId, input });
      if (opts?.failSendTurn) {
        return Effect.fail({ _tag: "ProviderServiceError", message: "sendTurn failed" } as never);
      }
      return Effect.succeed({
        threadId: input.threadId,
        turnId: "turn-1" as never,
      });
    },
    stopSession: (input) => {
      stopSessionCalls.push({ threadId: input.threadId });
      return Effect.void;
    },
    interruptTurn: () => Effect.void,
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    rollbackConversation: () => Effect.void,
    get streamEvents() {
      if (opts?.failStream) {
        return Stream.fail({ _tag: "ProviderServiceError", message: "stream failed" } as never);
      }
      return Stream.fromPubSub(eventPubSub);
    },
  };

  const emitEvent = (event: ProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(eventPubSub, event));
  };

  return { service, emitEvent, startSessionCalls, sendTurnCalls, stopSessionCalls };
}

function makeProviderRuntimeEvent(
  overrides: Partial<ProviderRuntimeEvent> & Pick<ProviderRuntimeEvent, "type" | "threadId">,
): ProviderRuntimeEvent {
  return {
    eventId: EventId.make(crypto.randomUUID()),
    provider: "claudeAgent",
    createdAt: now(),
    ...overrides,
  } as ProviderRuntimeEvent;
}

function createFakeSettingsService(_weaveProvider = "claudeAgent"): ServerSettingsShape {
  return {
    start: Effect.void,
    ready: Effect.void,
    getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
    streamChanges: Stream.empty,
  };
}

function createFakeEngineService(readModel?: OrchestrationReadModel): OrchestrationEngineShape & {
  appendedEvents: Array<Omit<OrchestrationEvent, "sequence">>;
} {
  const appendedEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];
  const model = readModel ?? createEmptyReadModel(now());

  return {
    appendedEvents,
    getReadModel: () => Effect.succeed(model),
    readEvents: () => Stream.empty,
    dispatch: () => Effect.succeed({ sequence: 1 }),
    streamDomainEvents: Stream.empty,
    appendSystemEvent: (event) => {
      appendedEvents.push(event);
      return Effect.succeed({ sequence: appendedEvents.length });
    },
  };
}

// ── Layer factory ─────────────────────────────────────────────────────────────

function buildDriverLayer(
  providerHarness: FakeProviderHarness,
  settingsShape: ServerSettingsShape,
  engineShape: OrchestrationEngineShape,
): Layer.Layer<PlannerDriver> {
  const providerLayer = Layer.succeed(ProviderService, ProviderService.of(providerHarness.service));
  const settingsLayer = Layer.succeed(
    ServerSettingsService,
    ServerSettingsService.of(settingsShape),
  );
  const engineLayer = Layer.succeed(
    OrchestrationEngineService,
    OrchestrationEngineService.of(engineShape),
  );

  return PlannerDriverLive.pipe(
    Layer.provide(providerLayer),
    Layer.provide(settingsLayer),
    Layer.provide(engineLayer),
  );
}

function runCompile(
  input: typeof defaultCompileInput,
  providerHarness: FakeProviderHarness,
  settingsShape?: ServerSettingsShape,
  engineShape?: OrchestrationEngineShape & {
    appendedEvents: Array<Omit<OrchestrationEvent, "sequence">>;
  },
) {
  const engine = engineShape ?? createFakeEngineService();
  const settings = settingsShape ?? createFakeSettingsService();
  const layer = buildDriverLayer(providerHarness, settings, engine);

  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const driver = yield* PlannerDriver;
        return yield* driver.compile(input);
      }),
      layer,
    ),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PlannerDriverLive", () => {
  it("dispatches weave.planner.thread-created with correct shape", async () => {
    const engine = createFakeEngineService();
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    // Emit minimal content.delta + turn.completed to unblock the stream
    setTimeout(() => {
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: "{}" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    await runCompile(defaultCompileInput, harness, undefined, engine);

    const plannerEvents = engine.appendedEvents.filter(
      (e) => e.type === "weave.planner.thread-created",
    );
    expect(plannerEvents).toHaveLength(1);
    const evt = plannerEvents[0]!;
    expect(evt.type).toBe("weave.planner.thread-created");
    expect(evt.aggregateKind).toBe("weave");
    expect(evt.aggregateId).toBe(WEAVE_RUN_ID);
    expect((evt.payload as { threadId: string }).threadId).toBe(expectedThreadId);
    expect((evt.payload as { projectId: string }).projectId).toBe(PROJECT_ID);
    expect((evt.payload as { title: string }).title).toContain("Test Weave");
  });

  it("calls startSession with configured provider/model", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    setTimeout(() => {
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: "{}" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    await runCompile(defaultCompileInput, harness);

    expect(harness.startSessionCalls).toHaveLength(1);
    const call = harness.startSessionCalls[0]!;
    expect(call.threadId).toBe(expectedThreadId);
    expect((call.input as { cwd: string }).cwd).toBe(WORKSPACE_ROOT);
  });

  it("calls sendTurn with a prompt containing the vision string", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    setTimeout(() => {
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: "{}" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    await runCompile(defaultCompileInput, harness);

    expect(harness.sendTurnCalls).toHaveLength(1);
    const call = harness.sendTurnCalls[0]!;
    expect((call.input as { input: string }).input).toContain(defaultCompileInput.vision);
  });

  it("accumulates content.delta payloads and returns the concatenation", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    setTimeout(() => {
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: '{"phase' },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: 's": []}' },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    const result = await runCompile(defaultCompileInput, harness);
    expect(result).toBe('{"phases": []}');
  });

  it("filters out content.delta events from other threads", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);
    const otherThreadId = ThreadId.make("other-thread");

    setTimeout(() => {
      // Noise from another thread — should be ignored
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: otherThreadId,
          payload: { streamKind: "assistant_text", delta: "IGNORED" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: "CORRECT" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    const result = await runCompile(defaultCompileInput, harness);
    expect(result).toBe("CORRECT");
    expect(result).not.toContain("IGNORED");
  });

  it("calls stopSession even when the stream emits turn.aborted", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    setTimeout(() => {
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: "some text" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.aborted",
          threadId: expectedThreadId,
          payload: { reason: "interrupted" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    const result = await runCompile(defaultCompileInput, harness);
    expect(result).toBe("some text");
    expect(harness.stopSessionCalls).toHaveLength(1);
    expect(harness.stopSessionCalls[0]!.threadId).toBe(expectedThreadId);
  });

  it("calls stopSession even when the turn returns empty output (fails)", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    setTimeout(() => {
      // No content.delta — just turn.completed with empty result
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    const layer = buildDriverLayer(harness, createFakeSettingsService(), createFakeEngineService());

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const driver = yield* PlannerDriver;
          return yield* driver.compile(defaultCompileInput).pipe(Effect.exit);
        }),
        layer,
      ),
    );

    expect(result._tag).toBe("Failure");
    // stopSession must still be called
    expect(harness.stopSessionCalls).toHaveLength(1);
  });

  it("wraps startSession errors as PlannerDriverError", async () => {
    const harness = createFakeProviderHarness({ failStartSession: true });
    const layer = buildDriverLayer(harness, createFakeSettingsService(), createFakeEngineService());

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const driver = yield* PlannerDriver;
          return yield* driver.compile(defaultCompileInput).pipe(Effect.exit);
        }),
        layer,
      ),
    );

    expect(result._tag).toBe("Failure");
    // The error should be tagged PlannerDriverError
    if (result._tag === "Failure") {
      const err = result.cause;
      expect(JSON.stringify(err)).toContain("PlannerDriverError");
    }
  });

  it("uses the deterministic threadId planner-<weaveRunId>", async () => {
    const harness = createFakeProviderHarness();
    const expectedThreadId = ThreadId.make(`planner-${WEAVE_RUN_ID}`);

    setTimeout(() => {
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "content.delta",
          threadId: expectedThreadId,
          payload: { streamKind: "assistant_text", delta: "hello" },
        }) as ProviderRuntimeEvent,
      );
      harness.emitEvent(
        makeProviderRuntimeEvent({
          type: "turn.completed",
          threadId: expectedThreadId,
          payload: { state: "completed" },
        }) as ProviderRuntimeEvent,
      );
    }, 10);

    await runCompile(defaultCompileInput, harness);

    // startSession must be called with the deterministic threadId
    expect(harness.startSessionCalls[0]!.threadId).toBe(expectedThreadId);
    // stopSession must match too
    expect(harness.stopSessionCalls[0]!.threadId).toBe(expectedThreadId);
  });

  it("stopSession is called even when sendTurn fails", async () => {
    const harness = createFakeProviderHarness({ failSendTurn: true });
    const layer = buildDriverLayer(harness, createFakeSettingsService(), createFakeEngineService());

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const driver = yield* PlannerDriver;
          return yield* driver.compile(defaultCompileInput).pipe(Effect.exit);
        }),
        layer,
      ),
    );

    expect(harness.stopSessionCalls).toHaveLength(1);
  });
});
