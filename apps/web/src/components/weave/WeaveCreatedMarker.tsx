import type { EnvironmentId, WeaveRunId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

export interface WeaveCreatedMarkerProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly title: string;
}

export function WeaveCreatedMarker({ environmentId, weaveRunId, title }: WeaveCreatedMarkerProps) {
  return (
    <div className="my-4 px-4 py-2 border-y border-cyan-500/30 bg-cyan-500/5 flex items-center gap-2">
      <span className="text-cyan-600">◇</span>
      <span className="text-sm">Compiled a Weave: </span>
      <Link
        to="/$environmentId/weave/$weaveRunId"
        params={{ environmentId, weaveRunId }}
        className="text-sm font-medium hover:underline"
      >
        {title}
      </Link>
    </div>
  );
}
