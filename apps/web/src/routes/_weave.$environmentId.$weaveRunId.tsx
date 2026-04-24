import type { EnvironmentId, WeaveRunId } from "@t3tools/contracts";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { WeaveView } from "../components/weave/WeaveView";
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
    <WeaveView
      environmentId={environmentId as EnvironmentId}
      weaveRunId={weaveRunId as WeaveRunId}
    />
  );
}
