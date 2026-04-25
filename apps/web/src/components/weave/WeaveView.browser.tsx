// Production CSS is part of the behavior under test.
import "../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type OrchestrationWeaveRunShell,
  type ProjectId,
  type ServerConfig,
  type ServerLifecycleWelcomePayload,
  type ThreadId,
  type WeaveNodeId,
  type WeaveRunId,
  WS_METHODS,
} from "@t3tools/contracts";
import type {
  BlueprintVersion,
  WeaveNodeMeta,
  WeavePhaseId,
  WeaveRunProjection,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { __resetEnvironmentApiOverridesForTests } from "../../environmentApi";
import {
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
} from "../../environments/runtime";
import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { getServerConfig } from "../../rpc/serverState";
import { getRouter } from "../../router";
import { selectBootstrapCompleteForActiveEnvironment, useStore } from "../../store";
import { useUiStateStore } from "../../uiStateStore";
import { createAuthenticatedSessionHandlers } from "../../../test/authHttpHandlers";
import { BrowserWsRpcHarness, type NormalizedWsRpcRequestBody } from "../../../test/wsRpcHarness";

import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

vi.mock("../../lib/gitStatusState", () => ({
  useGitStatus: () => ({ data: null, error: null, cause: null, isPending: false }),
  useGitStatuses: () => new Map(),
  refreshGitStatus: () => Promise.resolve(null),
  resetGitStatusStateForTests: () => undefined,
}));

const THREAD_ID = "thread-weave-browser-test" as ThreadId;
const PROJECT_ID = "project-weave-1" as ProjectId;
const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const WEAVE_RUN_ID = "weave-run-browser-test" as WeaveRunId;
const NODE_A_ID = "node-a" as WeaveNodeId;
const NODE_B_ID = "node-b" as WeaveNodeId;
const NODE_C_ID = "node-c" as WeaveNodeId;
const PHASE_ID = "phase-1" as WeavePhaseId;
const NOW_ISO = "2026-04-20T10:00:00.000Z";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: ServerLifecycleWelcomePayload;
}

let fixture: TestFixture;
const rpcHarness = new BrowserWsRpcHarness();
const wsRequests = rpcHarness.requests;
let customWsRpcResolver: ((body: NormalizedWsRpcRequestBody) => unknown | undefined) | null = null;
const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: LOCAL_ENVIRONMENT_ID,
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: NOW_ISO,
        models: [],
        slashCommands: [],
        skills: [],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  };
}

function createBaseSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Weave Test Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: { provider: "codex", model: "gpt-5" },
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "weave test thread",
        modelSelection: { provider: "codex", model: "gpt-5" },
        interactionMode: "default",
        kind: "chat",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: "msg-1" as MessageId,
            role: "user",
            text: "build me a blog",
            turnId: null,
            streaming: false,
            createdAt: NOW_ISO,
            updatedAt: NOW_ISO,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    weaveRuns: new Map(),
    updatedAt: NOW_ISO,
  };
}

function createWeaveRunShell(
  status: OrchestrationWeaveRunShell["status"],
  overrides?: Partial<OrchestrationWeaveRunShell>,
): OrchestrationWeaveRunShell {
  return {
    id: WEAVE_RUN_ID,
    projectId: PROJECT_ID,
    title: "build me a blog",
    status,
    pendingCount: 3,
    readyCount: 0,
    runningCount: 0,
    verifiedCount: 0,
    failedCount: 0,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

function createThreeNodeBlueprint() {
  return {
    version: 1 as BlueprintVersion,
    nodes: [
      {
        id: NODE_A_ID,
        title: "Setup DB schema",
        description: "Create the database schema",
        kind: "scaffold" as const,
        phaseId: PHASE_ID,
        scope: { readSet: [], writeSet: ["src/db/**"] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "schema migrations pass",
        dependsOn: [],
        status: "pending" as const,
      },
      {
        id: NODE_B_ID,
        title: "Build API layer",
        description: "Implement REST endpoints",
        kind: "raw" as const,
        phaseId: PHASE_ID,
        scope: { readSet: ["src/db/**"], writeSet: ["src/api/**"] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "API tests pass",
        dependsOn: [NODE_A_ID],
        status: "pending" as const,
      },
      {
        id: NODE_C_ID,
        title: "Build frontend",
        description: "Create the React components",
        kind: "raw" as const,
        phaseId: PHASE_ID,
        scope: { readSet: ["src/api/**"], writeSet: ["src/ui/**"] },
        inputContractIds: [],
        outputContractIds: [],
        verifierDescription: "UI tests pass",
        dependsOn: [NODE_B_ID],
        status: "pending" as const,
      },
    ],
    phases: [
      {
        id: PHASE_ID,
        ordinal: 0 as number & { readonly NonNegativeInt: unique symbol },
        title: "Phase 1: Core",
        description: "Foundation layer",
        approval: "pending" as const,
      },
    ],
    contracts: [],
    decisions: [],
    compiledAt: NOW_ISO,
    compiledBy: "planner" as const,
  };
}

function createWeaveRunProjection(
  status: OrchestrationWeaveRunShell["status"],
  options?: {
    withBlueprint?: boolean;
    verifiedCount?: number;
    childThreads?: ReadonlyMap<WeaveNodeId, { threadId: ThreadId; worktreePath: string }>;
  },
): WeaveRunProjection {
  const blueprint = options?.withBlueprint === true ? createThreeNodeBlueprint() : null;
  const nodeMeta = new Map<WeaveNodeId, WeaveNodeMeta>();
  if (blueprint) {
    for (const node of blueprint.nodes) {
      nodeMeta.set(node.id, { status: node.status });
    }
    if ((options?.verifiedCount ?? 0) > 0) {
      nodeMeta.set(NODE_A_ID, { status: "verified" });
    }
  }
  return {
    run: {
      id: WEAVE_RUN_ID,
      projectId: PROJECT_ID,
      title: "build me a blog",
      vision: "build me a blog",
      status,
      concurrencyCap: 1,
      createdAt: NOW_ISO,
    },
    currentBlueprint: blueprint,
    nodeMeta,
    openDecisions: new Set(),
    autoDecisionLog: [],
    phaseApprovals: new Map(),
    childThreads: options?.childThreads ?? new Map(),
  };
}

function toShellSnapshot(snapshot: OrchestrationReadModel) {
  return {
    snapshotSequence: snapshot.snapshotSequence,
    projects: snapshot.projects.map((project) => ({
      id: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryIdentity: project.repositoryIdentity ?? null,
      defaultModelSelection: project.defaultModelSelection,
      scripts: project.scripts,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    threads: snapshot.threads.map((thread) => ({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      session: thread.session,
      latestUserMessageAt:
        thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    })),
    weaveRuns: [],
    updatedAt: snapshot.updatedAt,
  };
}

function buildFixture(snapshot: OrchestrationReadModel): TestFixture {
  return {
    snapshot,
    serverConfig: createBaseServerConfig(),
    welcome: {
      environment: {
        environmentId: LOCAL_ENVIRONMENT_ID,
        label: "Local environment",
        platform: { os: "darwin" as const, arch: "arm64" as const },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: true },
      },
      cwd: "/repo/project",
      projectName: "Weave Test Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function resolveWsRpc(body: NormalizedWsRpcRequestBody): unknown {
  const customResult = customWsRpcResolver?.(body);
  if (customResult !== undefined) {
    return customResult;
  }
  const tag = body._tag;
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      nextCursor: null,
      totalCount: 1,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  if (tag === WS_METHODS.shellOpenInEditor) {
    return null;
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    void rpcHarness.connect(client);
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      void rpcHarness.onMessage(rawData);
    });
  }),
  ...createAuthenticatedSessionHandlers(() => fixture.serverConfig.auth),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
    },
    { timeout: 4_000, interval: 16 },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

async function waitForWsClient(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        wsRequests.some((request) => request._tag === ORCHESTRATION_WS_METHODS.subscribeShell),
      ).toBe(true);
      expect(
        wsRequests.some((request) => request._tag === WS_METHODS.subscribeServerLifecycle),
      ).toBe(true);
      expect(wsRequests.some((request) => request._tag === WS_METHODS.subscribeServerConfig)).toBe(
        true,
      );
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function waitForAppBootstrap(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(getServerConfig()).not.toBeNull();
      expect(selectBootstrapCompleteForActiveEnvironment(useStore.getState())).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function waitForURL(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = "";
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname;
      expect(predicate(pathname), errorMessage).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  return pathname;
}

interface MountedApp {
  cleanup: () => Promise<void>;
  router: ReturnType<typeof getRouter>;
}

async function mountApp(options: {
  snapshot: OrchestrationReadModel;
  initialPath: string;
  resolveRpc?: (body: NormalizedWsRpcRequestBody) => unknown | undefined;
  weaveRunProjection?: WeaveRunProjection;
}): Promise<MountedApp> {
  fixture = buildFixture(options.snapshot);
  customWsRpcResolver = options.resolveRpc ?? null;
  await page.viewport(1_200, 900);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: [options.initialPath],
    }),
  );

  const weaveProjection = options.weaveRunProjection;

  const screen = await render(
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>,
    { container: host },
  );

  await waitForWsClient();
  await waitForAppBootstrap();

  if (weaveProjection) {
    // Seed the store with the weave run shell + detail directly so WeaveView
    // can render without waiting for a live server subscription.
    useStore.setState((state) => {
      const envState = state.environmentStateById[LOCAL_ENVIRONMENT_ID];
      if (!envState) return state;
      return {
        ...state,
        environmentStateById: {
          ...state.environmentStateById,
          [LOCAL_ENVIRONMENT_ID]: {
            ...envState,
            weaveRunsById: {
              ...envState.weaveRunsById,
              [WEAVE_RUN_ID]: createWeaveRunShell(weaveProjection.run.status),
            },
            weaveRunDetailById: {
              ...envState.weaveRunDetailById,
              [WEAVE_RUN_ID]: weaveProjection,
            },
          },
        },
      };
    });
  }

  await waitForLayout();

  const cleanup = async () => {
    customWsRpcResolver = null;
    await screen.unmount();
    host.remove();
    await waitForLayout();
  };

  return { cleanup, router };
}

describe("WeaveView browser tests", () => {
  beforeAll(async () => {
    fixture = buildFixture(createBaseSnapshot());
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await rpcHarness.disconnect();
    await worker.stop();
  });

  beforeEach(async () => {
    await rpcHarness.reset({
      resolveUnary: resolveWsRpc,
      getInitialStreamValues: (request) => {
        if (request._tag === WS_METHODS.subscribeServerLifecycle) {
          return [
            {
              version: 1,
              sequence: 1,
              type: "welcome",
              payload: fixture.welcome,
            },
          ];
        }
        if (request._tag === WS_METHODS.subscribeServerConfig) {
          return [{ version: 1, type: "snapshot", config: fixture.serverConfig }];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
          return [{ kind: "snapshot", snapshot: toShellSnapshot(fixture.snapshot) }];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeThread) {
          const thread = fixture.snapshot.threads.find((entry) => entry.id === request.threadId);
          return thread
            ? [
                {
                  kind: "snapshot",
                  snapshot: {
                    snapshotSequence: fixture.snapshot.snapshotSequence,
                    thread,
                  },
                },
              ]
            : [];
        }
        return [];
      },
    });
    await __resetLocalApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
    wsRequests.length = 0;
    customWsRpcResolver = null;
    __resetEnvironmentApiOverridesForTests();
    resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
    });
  });

  afterEach(() => {
    customWsRpcResolver = null;
    document.body.innerHTML = "";
  });

  // --------------------------------------------------------------------------
  // Test 1: /weave dispatches weave.create and navigates
  // --------------------------------------------------------------------------
  it("dispatches weave.create and navigates to the weave route on /weave submit", async () => {
    const snapshot = createBaseSnapshot();
    const mounted = await mountApp({
      snapshot,
      initialPath: `/${LOCAL_ENVIRONMENT_ID}/${THREAD_ID}`,
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return { sequence: 2 };
        }
        return undefined;
      },
    });

    try {
      // Wait for composer editor
      const composerEditor = await waitForElement(
        () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
        "Composer editor should be visible",
      );

      composerEditor.focus();

      // Insert /weave text
      const beforeInputEvent = new InputEvent("beforeinput", {
        data: "/weave",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      });
      composerEditor.dispatchEvent(beforeInputEvent);
      if (!beforeInputEvent.defaultPrevented) {
        document.execCommand("insertText", false, "/weave");
      }
      await waitForLayout();

      // Press Enter to submit
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();

      // Assert: dispatchCommand with type weave.create was sent
      await vi.waitFor(
        () => {
          const dispatchReq = wsRequests.find(
            (request) => request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand,
          );
          expect(dispatchReq).toBeDefined();
          expect(dispatchReq).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "weave.create",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      // Assert: router navigated away from the thread URL
      await waitForURL(
        mounted.router,
        (pathname) => {
          // After /weave, the app navigates to /$envId/$newWeaveRunId
          // which is a different path than /$envId/$threadId
          const parts = pathname.split("/").filter(Boolean);
          return parts.length >= 2 && parts[0] === LOCAL_ENVIRONMENT_ID && parts[1] !== THREAD_ID;
        },
        `Expected navigation to a weave run URL. Got: ${mounted.router.state.location.pathname}`,
      );
    } finally {
      await mounted.cleanup();
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: blueprint list renders phase-grouped with statuses
  // --------------------------------------------------------------------------
  it("renders blueprint list with phase headings and node statuses", async () => {
    const snapshot = createBaseSnapshot();
    const projection = createWeaveRunProjection("reviewing", { withBlueprint: true });

    const mounted = await mountApp({
      snapshot,
      initialPath: `/${LOCAL_ENVIRONMENT_ID}/${WEAVE_RUN_ID}`,
      weaveRunProjection: projection,
    });

    try {
      // Phase heading visible
      await vi.waitFor(
        () => {
          const headings = Array.from(document.querySelectorAll("h2"));
          const phaseHeading = headings.find((h) => h.textContent?.includes("Phase 1: Core"));
          expect(phaseHeading, "Phase heading 'Phase 1: Core' should be visible").toBeTruthy();
        },
        { timeout: 8_000, interval: 16 },
      );

      // 3 node cards visible
      await vi.waitFor(
        () => {
          const nodeButtons = Array.from(
            document.querySelectorAll<HTMLButtonElement>("button"),
          ).filter(
            (btn) =>
              btn.textContent?.includes("Setup DB schema") ||
              btn.textContent?.includes("Build API layer") ||
              btn.textContent?.includes("Build frontend"),
          );
          expect(nodeButtons.length, "Expected 3 node cards").toBe(3);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  // --------------------------------------------------------------------------
  // Test 4: counters update live on weave-run-upserted event
  // --------------------------------------------------------------------------
  it("updates counters when a weave-run-upserted event arrives with verifiedCount === 1", async () => {
    const snapshot = createBaseSnapshot();
    const projection = createWeaveRunProjection("running", { withBlueprint: true });

    const mounted = await mountApp({
      snapshot,
      initialPath: `/${LOCAL_ENVIRONMENT_ID}/${WEAVE_RUN_ID}`,
      weaveRunProjection: projection,
    });

    try {
      // Initially verifiedCount === 0
      await vi.waitFor(
        () => {
          expect(document.body.textContent ?? "").toContain("Verified");
        },
        { timeout: 8_000, interval: 16 },
      );

      const getVerifiedValue = () => {
        const headerEl = document.querySelector("header");
        if (!headerEl) return null;
        const labels = Array.from(headerEl.querySelectorAll("div")).filter(
          (el) => el.textContent?.trim() === "Verified",
        );
        if (labels.length === 0) return null;
        return labels[0]?.previousElementSibling?.textContent?.trim() ?? null;
      };

      await vi.waitFor(
        () => {
          expect(getVerifiedValue(), "Initial verified count should be 0").toBe("0");
        },
        { timeout: 8_000, interval: 16 },
      );

      // Update the shell in the store to reflect verifiedCount === 1
      useStore.setState((state) => {
        const envState = state.environmentStateById[LOCAL_ENVIRONMENT_ID];
        if (!envState) return state;
        return {
          ...state,
          environmentStateById: {
            ...state.environmentStateById,
            [LOCAL_ENVIRONMENT_ID]: {
              ...envState,
              weaveRunsById: {
                ...envState.weaveRunsById,
                [WEAVE_RUN_ID]: createWeaveRunShell("running", {
                  verifiedCount: 1,
                  pendingCount: 2,
                }),
              },
            },
          },
        };
      });

      await vi.waitFor(
        () => {
          expect(getVerifiedValue(), "Verified count should update to 1").toBe("1");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  // --------------------------------------------------------------------------
  // Test 5: completion banner appears when status becomes "complete"
  // --------------------------------------------------------------------------
  it("shows the completion banner when status becomes complete", async () => {
    const snapshot = createBaseSnapshot();
    const projection = createWeaveRunProjection("reviewing", { withBlueprint: true });

    const mounted = await mountApp({
      snapshot,
      initialPath: `/${LOCAL_ENVIRONMENT_ID}/${WEAVE_RUN_ID}`,
      weaveRunProjection: projection,
    });

    try {
      // Transition to "complete"
      useStore.setState((state) => {
        const envState = state.environmentStateById[LOCAL_ENVIRONMENT_ID];
        if (!envState) return state;
        return {
          ...state,
          environmentStateById: {
            ...state.environmentStateById,
            [LOCAL_ENVIRONMENT_ID]: {
              ...envState,
              weaveRunsById: {
                ...envState.weaveRunsById,
                [WEAVE_RUN_ID]: createWeaveRunShell("complete", {
                  pendingCount: 0,
                  verifiedCount: 3,
                }),
              },
            },
          },
        };
      });

      // Assert: completion banner visible
      await vi.waitFor(
        () => {
          expect(document.body.textContent ?? "", "Completion banner should be visible").toContain(
            "Weave complete.",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
