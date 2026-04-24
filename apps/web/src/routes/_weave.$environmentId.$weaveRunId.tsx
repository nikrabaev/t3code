import { createFileRoute, useParams } from "@tanstack/react-router";
import { parseWeaveRouteSearch } from "../weave/weaveRouteSearch";

export const Route = createFileRoute("/_weave/$environmentId/$weaveRunId")({
  validateSearch: (search) => parseWeaveRouteSearch(search),
  component: WeaveRouteComponent,
});

function WeaveRouteComponent() {
  const { environmentId, weaveRunId } = useParams({
    from: "/_weave/$environmentId/$weaveRunId",
  });
  return (
    <div className="p-8">
      <div>Weave run: {weaveRunId}</div>
      <div>Environment: {environmentId}</div>
      <div className="text-muted-foreground text-sm">
        WeaveView will render here in Task 7.
      </div>
    </div>
  );
}
