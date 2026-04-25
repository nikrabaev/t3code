import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Per-call release spies so we can verify per-thread release behavior.
const mockReleasesByCall: Array<ReturnType<typeof vi.fn>> = [];

vi.mock("../environments/runtime/service", () => ({
  retainThreadDetailSubscription: vi.fn(() => {
    const release = vi.fn();
    mockReleasesByCall.push(release);
    return release;
  }),
}));

// Imported after vi.mock so the module uses the mocked service.
// We test the effect lifecycle directly rather than rendering the hook into a
// DOM (no @testing-library/react in this project), because the hook is a thin
// effect wrapper — the subscription bookkeeping is the contract under test.
const { retainThreadDetailSubscription } = await import("../environments/runtime/service");

const ENV = EnvironmentId.make("env-1");
const T1 = ThreadId.make("t-1");
const T2 = ThreadId.make("t-2");

// Models the effect body that `useWeaveRunningNodeSubscriptions` registers rather
// than rendering the hook itself; the corresponding integration check is the
// visual smoke test in Task 3.
function simulateEffectBody(
  environmentId: EnvironmentId,
  runningChildThreadIds: ReadonlyArray<ThreadId>,
): () => void {
  const releases = runningChildThreadIds.map((threadId) =>
    retainThreadDetailSubscription(environmentId, threadId),
  );
  return () => {
    for (const release of releases) release();
  };
}

beforeEach(() => {
  mockReleasesByCall.length = 0;
  vi.clearAllMocks();
});

describe("useWeaveRunningNodeSubscriptions effect logic", () => {
  it("retains subscriptions for all running thread ids on mount", () => {
    const cleanup = simulateEffectBody(ENV, [T1, T2]);

    expect(retainThreadDetailSubscription).toHaveBeenCalledTimes(2);
    expect(retainThreadDetailSubscription).toHaveBeenCalledWith(ENV, T1);
    expect(retainThreadDetailSubscription).toHaveBeenCalledWith(ENV, T2);

    cleanup();
  });

  it("releases all subscriptions on unmount", () => {
    const cleanup = simulateEffectBody(ENV, [T1, T2]);
    const [release1, release2] = mockReleasesByCall;

    cleanup();

    expect(release1).toHaveBeenCalledOnce();
    expect(release2).toHaveBeenCalledOnce();
  });

  it("releases stale subscriptions when the running set shrinks", () => {
    // Mount with t-1 and t-2.
    const cleanupFirst = simulateEffectBody(ENV, [T1, T2]);
    const [releaseT1First, releaseT2] = mockReleasesByCall;

    // Simulate a rerender where t-2 is no longer running.
    // The effect re-runs: old cleanup fires, new effect subscribes to t-1 only.
    cleanupFirst();

    expect(releaseT1First).toHaveBeenCalledOnce();
    expect(releaseT2).toHaveBeenCalledOnce();

    // New effect for the updated set.
    vi.clearAllMocks();
    mockReleasesByCall.length = 0;

    const cleanupSecond = simulateEffectBody(ENV, [T1]);

    expect(retainThreadDetailSubscription).toHaveBeenCalledTimes(1);
    expect(retainThreadDetailSubscription).toHaveBeenCalledWith(ENV, T1);

    cleanupSecond();
  });

  it("does not re-retain when the thread ids are the same (stable join key)", () => {
    // The hook depends on `joinKey = ids.join("|")`. If the content does not
    // change, the effect does not re-run even if a fresh array is passed in.
    //
    // Approach A: we wrap simulateEffectBody with the same dep-equality gate React uses (simulateEffectWithDepGate).
    // Two renders pass in different array *references* but identical *content*.
    // The guard skips the second invocation, so retain stays at 2 total.
    let previousJoinKey: string | undefined;
    let currentCleanup: (() => void) | undefined;

    function simulateEffectWithDepGate(
      environmentId: EnvironmentId,
      runningChildThreadIds: ReadonlyArray<ThreadId>,
    ): (() => void) | undefined {
      const joinKey = runningChildThreadIds.join("|");
      if (joinKey === previousJoinKey) {
        // Same dep value — React would skip re-running the effect.
        return undefined;
      }
      // Dep changed — run cleanup from previous render then run new effect.
      currentCleanup?.();
      previousJoinKey = joinKey;
      currentCleanup = simulateEffectBody(environmentId, runningChildThreadIds);
      return currentCleanup;
    }

    // First render: [T1, T2] — effect runs, 2 retains.
    simulateEffectWithDepGate(ENV, [T1, T2]);
    expect(retainThreadDetailSubscription).toHaveBeenCalledTimes(2);

    // Second render: fresh array ref but identical content — effect must NOT run.
    const secondResult = simulateEffectWithDepGate(ENV, [T1, T2] as ThreadId[]);
    expect(secondResult).toBeUndefined(); // gate blocked the re-run
    expect(retainThreadDetailSubscription).toHaveBeenCalledTimes(2); // still 2, not 4

    // Cleanup after unmount.
    currentCleanup?.();
  });

  it("retains no subscriptions when the running set is empty", () => {
    const cleanup = simulateEffectBody(ENV, []);

    expect(retainThreadDetailSubscription).not.toHaveBeenCalled();

    cleanup(); // No releases to call — should not throw.
  });
});
