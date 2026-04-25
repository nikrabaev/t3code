import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";

import { retainThreadDetailSubscription } from "../environments/runtime/service";

/**
 * Retains thread detail subscriptions for the currently running Weave nodes.
 *
 * Only a small subset of nodes are running at once (concurrencyCap = 1 in v0.1),
 * so this targeted hook keeps subscription churn low.
 *
 * IMPORTANT: The caller must pass `runningChildThreadIds` sorted before passing
 * them in. The hook uses a `.join("|")` of the ids as a stable dependency key so
 * that the effect only re-runs when the *content* changes, not on every render
 * (a fresh array reference would otherwise trigger the effect every render).
 */
export function useWeaveRunningNodeSubscriptions(
  environmentId: EnvironmentId,
  runningChildThreadIds: ReadonlyArray<ThreadId>,
): void {
  const joinKey = runningChildThreadIds.join("|");

  useEffect(() => {
    const releases = runningChildThreadIds.map((threadId) =>
      retainThreadDetailSubscription(environmentId, threadId),
    );
    return () => {
      for (const release of releases) release();
    };
    // joinKey is a stable string derived from the running thread ids — depending
    // on the array reference would cause the effect to re-run every render
    // because the parent passes a fresh array each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId, joinKey]);
}
