import { useNavigate, useParams } from "@tanstack/react-router";
import type {
  EnvironmentId,
  ThreadId,
  WeaveNode,
  WeaveNodeId,
  WeaveNodeStatus,
  WeaveRunId,
  WeaveRunProjection,
} from "@t3tools/contracts";
import { useMemo } from "react";
import { useTickingNow } from "../../hooks/useTickingNow";
import { useLatestAssistantText } from "../../weave/weaveStore";
import { useWeaveRunningNodeSubscriptions } from "../../weave/useWeaveRunningNodeSubscriptions";
import { WeaveNodeCard } from "./WeaveNodeCard";

export interface WeaveBlueprintListProps {
  readonly detail: WeaveRunProjection;
  readonly openNodeId?: WeaveNodeId | undefined;
}

interface NodeRowProps {
  readonly node: WeaveNode;
  readonly detail: WeaveRunProjection;
  readonly environmentId: EnvironmentId;
  readonly openNodeId: WeaveNodeId | undefined;
  readonly now: number;
  readonly dependsOnStatuses: ReadonlyMap<WeaveNodeId, WeaveNodeStatus>;
  readonly onClick: () => void;
}

function NodeRow({
  node,
  detail,
  environmentId,
  openNodeId,
  now,
  dependsOnStatuses,
  onClick,
}: NodeRowProps) {
  const meta = detail.nodeMeta.get(node.id) ?? null;
  const childThreadId =
    meta?.status === "running" ? (detail.childThreads.get(node.id)?.threadId ?? null) : null;
  // Always call the hook (rules of hooks). Use a stable sentinel when there's
  // no thread to look up — the selector returns null for unknown ids.
  const latestMessage = useLatestAssistantText(
    environmentId,
    childThreadId ?? ("__none__" as ThreadId),
  );
  return (
    <WeaveNodeCard
      node={node}
      status={meta?.status ?? "pending"}
      meta={meta}
      now={now}
      latestMessage={childThreadId ? latestMessage : null}
      dependsOnStatuses={dependsOnStatuses}
      selected={openNodeId === node.id}
      onClick={onClick}
    />
  );
}

export function WeaveBlueprintList({ detail, openNodeId }: WeaveBlueprintListProps) {
  const navigate = useNavigate();
  const { environmentId: rawEnvironmentId, weaveRunId: rawWeaveRunId } = useParams({
    from: "/_weave/$environmentId/weave/$weaveRunId",
  });
  const environmentId = rawEnvironmentId as EnvironmentId;
  const weaveRunId = rawWeaveRunId as WeaveRunId;
  const now = useTickingNow(1000);
  const blueprint = detail.currentBlueprint!;

  // Hoist dependsOnStatuses so it's computed once per render, not per row.
  const dependsOnStatuses = useMemo(
    () =>
      new Map<WeaveNodeId, WeaveNodeStatus>(
        Array.from(detail.nodeMeta, ([id, meta]) => [id, meta.status]),
      ),
    [detail.nodeMeta],
  );

  // Collect and subscribe to the thread detail streams for all running nodes.
  const runningChildThreadIds = useMemo(() => {
    const ids: ThreadId[] = [];
    for (const [nodeId, meta] of detail.nodeMeta) {
      if (meta.status === "running") {
        const child = detail.childThreads.get(nodeId);
        if (child) ids.push(child.threadId);
      }
    }
    ids.sort(); // stable order for the join key
    return ids;
  }, [detail.nodeMeta, detail.childThreads]);

  useWeaveRunningNodeSubscriptions(environmentId, runningChildThreadIds);

  // Group nodes by phase, preserving phase ordinal + node topological order.
  const phases = [...blueprint.phases].sort((a, b) => a.ordinal - b.ordinal);

  return (
    <div className="flex flex-col py-4">
      {phases.map((phase) => {
        const phaseNodes = blueprint.nodes.filter((n) => n.phaseId === phase.id);
        return (
          <section key={phase.id} className="mb-6">
            <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {phase.title}
            </h2>
            <div className="flex flex-col">
              {phaseNodes.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  detail={detail}
                  environmentId={environmentId}
                  openNodeId={openNodeId}
                  now={now}
                  dependsOnStatuses={dependsOnStatuses}
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/weave/$weaveRunId/node/$nodeId",
                      params: { environmentId, weaveRunId, nodeId: node.id },
                    })
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
