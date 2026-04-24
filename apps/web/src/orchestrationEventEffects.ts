import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";

export interface OrchestrationBatchEffects {
  promoteDraftThreadIds: ThreadId[];
  clearDeletedThreadIds: ThreadId[];
  removeTerminalStateThreadIds: ThreadId[];
  needsProviderInvalidation: boolean;
}

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const threadLifecycleEffects = new Map<
    ThreadId,
    {
      clearPromotedDraft: boolean;
      clearDeletedThread: boolean;
      removeTerminalState: boolean;
    }
  >();
  let needsProviderInvalidation = false;

  for (const event of events) {
    switch (event.type) {
      case "thread.turn-diff-completed":
      case "thread.reverted": {
        needsProviderInvalidation = true;
        break;
      }

      case "thread.created": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: true,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      case "thread.deleted": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: true,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.archived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.unarchived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      // Weave events — no batch effects in v0.1; routed explicitly so the
      // switch remains exhaustive when the default is removed in a future task.
      case "weave.created":
      case "weave.blueprint-compiled":
      case "weave.blueprint-approved":
      case "weave.node-dispatched":
      case "weave.node-verified":
      case "weave.node-failed":
      case "weave.decision-resolved":
      case "weave.phase-approved":
      case "weave.exited": {
        break;
      }

      default: {
        break;
      }
    }
  }

  const promoteDraftThreadIds: ThreadId[] = [];
  const clearDeletedThreadIds: ThreadId[] = [];
  const removeTerminalStateThreadIds: ThreadId[] = [];
  for (const [threadId, effect] of threadLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      promoteDraftThreadIds.push(threadId);
    }
    if (effect.clearDeletedThread) {
      clearDeletedThreadIds.push(threadId);
    }
    if (effect.removeTerminalState) {
      removeTerminalStateThreadIds.push(threadId);
    }
  }

  return {
    promoteDraftThreadIds,
    clearDeletedThreadIds,
    removeTerminalStateThreadIds,
    needsProviderInvalidation,
  };
}
