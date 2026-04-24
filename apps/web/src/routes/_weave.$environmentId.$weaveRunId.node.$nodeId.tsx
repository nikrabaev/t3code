import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/_weave/$environmentId/$weaveRunId/node/$nodeId")({
  component: WeaveRouteNodeComponent,
});

function WeaveRouteNodeComponent() {
  const { environmentId, weaveRunId, nodeId } = useParams({
    from: "/_weave/$environmentId/$weaveRunId/node/$nodeId",
  });
  return (
    <div className="p-8">
      <div>Weave run: {weaveRunId}</div>
      <div>Environment: {environmentId}</div>
      <div>Node: {nodeId}</div>
      <div className="text-muted-foreground text-sm">
        WeaveView with openNodeId will render here in Task 7.
      </div>
    </div>
  );
}
