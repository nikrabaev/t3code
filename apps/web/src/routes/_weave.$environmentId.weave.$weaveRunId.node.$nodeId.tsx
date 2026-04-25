import type { EnvironmentId, WeaveNodeId, WeaveRunId } from "@t3tools/contracts";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { WeaveView } from "../components/weave/WeaveView";

export const Route = createFileRoute("/_weave/$environmentId/weave/$weaveRunId/node/$nodeId")({
  component: WeaveRouteNodeComponent,
});

function WeaveRouteNodeComponent() {
  const { environmentId, weaveRunId, nodeId } = useParams({
    from: "/_weave/$environmentId/weave/$weaveRunId/node/$nodeId",
  });
  return (
    <WeaveView
      environmentId={environmentId as EnvironmentId}
      weaveRunId={weaveRunId as WeaveRunId}
      openNodeId={nodeId as WeaveNodeId}
    />
  );
}
