import type { EnvironmentId, ProjectId, WeaveRunId } from "@t3tools/contracts";
import { useStore } from "../store";

export function useWeaveRunsForProject(environmentId: EnvironmentId, projectId: ProjectId) {
  return useStore((state) =>
    Object.values(state.environmentStateById[environmentId]?.weaveRunsById ?? {}).filter(
      (run) => run.projectId === projectId,
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
