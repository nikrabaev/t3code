import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WeaveNodeId,
  WeaveNodeMeta,
  WeaveRunId,
  WeaveRunProjection,
} from "@t3tools/contracts";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";

export function useWeaveRunsForProject(environmentId: EnvironmentId, projectId: ProjectId) {
  return useStore(
    useShallow((state) =>
      Object.values(state.environmentStateById[environmentId]?.weaveRunsById ?? {}).filter(
        (run) => run.projectId === projectId,
      ),
    ),
  );
}

export function useWeaveRunShell(environmentId: EnvironmentId, weaveRunId: WeaveRunId) {
  return useStore(
    (state) => state.environmentStateById[environmentId]?.weaveRunsById[weaveRunId] ?? null,
  );
}

export function useWeaveRunDetail(environmentId: EnvironmentId, weaveRunId: WeaveRunId) {
  return useStore(
    (state) => state.environmentStateById[environmentId]?.weaveRunDetailById[weaveRunId] ?? null,
  );
}

export function getNodeMeta(detail: WeaveRunProjection, nodeId: WeaveNodeId): WeaveNodeMeta | null {
  return detail.nodeMeta.get(nodeId) ?? null;
}

export function useLatestAssistantText(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): string | null {
  return useStore((state) => {
    const env = state.environmentStateById[environmentId];
    if (!env) return null;
    const ids = env.messageIdsByThreadId[threadId];
    const byId = env.messageByThreadId[threadId];
    if (!ids || !byId) return null;
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      if (id === undefined) continue;
      const msg = byId[id];
      if (msg && msg.role === "assistant" && msg.text.length > 0) {
        return msg.text;
      }
    }
    return null;
  });
}
