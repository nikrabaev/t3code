import { useNavigate, useParams } from "@tanstack/react-router";
import type { WeaveNodeId, WeaveNodeStatus, WeaveRunProjection } from "@t3tools/contracts";
import { useTickingNow } from "../../hooks/useTickingNow";
import { WeaveNodeCard } from "./WeaveNodeCard";

export interface WeaveBlueprintListProps {
  readonly detail: WeaveRunProjection;
  readonly openNodeId?: WeaveNodeId | undefined;
}

export function WeaveBlueprintList({ detail, openNodeId }: WeaveBlueprintListProps) {
  const navigate = useNavigate();
  const { environmentId, weaveRunId } = useParams({
    from: "/_weave/$environmentId/weave/$weaveRunId",
  });
  const now = useTickingNow(1000);
  const blueprint = detail.currentBlueprint!;

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
                <WeaveNodeCard
                  key={node.id}
                  node={node}
                  status={detail.nodeMeta.get(node.id)?.status ?? "pending"}
                  meta={detail.nodeMeta.get(node.id) ?? null}
                  now={now}
                  dependsOnStatuses={
                    new Map<WeaveNodeId, WeaveNodeStatus>(
                      Array.from(detail.nodeMeta, ([id, meta]) => [id, meta.status]),
                    )
                  }
                  selected={openNodeId === node.id}
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
