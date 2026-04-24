import { useNavigate, useParams } from "@tanstack/react-router";
import type { WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";
import { WeaveNodeCard } from "./WeaveNodeCard";

export interface WeaveBlueprintListProps {
  readonly detail: WeaveRunProjection;
  readonly openNodeId?: WeaveNodeId;
}

export function WeaveBlueprintList({ detail, openNodeId }: WeaveBlueprintListProps) {
  const navigate = useNavigate();
  const { environmentId, weaveRunId } = useParams({
    from: "/_weave/$environmentId/$weaveRunId",
  });
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
                  status={detail.nodeStatuses.get(node.id) ?? "pending"}
                  dependsOnStatuses={detail.nodeStatuses}
                  selected={openNodeId === node.id}
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$weaveRunId/node/$nodeId",
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
