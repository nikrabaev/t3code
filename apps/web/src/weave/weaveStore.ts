import type {
  EnvironmentId,
  ProjectId,
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
