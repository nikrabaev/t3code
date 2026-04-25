import type { EnvironmentId, OrchestrationWeaveRunShell } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/utils";

export interface WeaveRunSidebarItemProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRun: OrchestrationWeaveRunShell;
  readonly active: boolean;
}

export function WeaveRunSidebarItem({ environmentId, weaveRun, active }: WeaveRunSidebarItemProps) {
  const total =
    weaveRun.pendingCount +
    weaveRun.readyCount +
    weaveRun.runningCount +
    weaveRun.verifiedCount +
    weaveRun.failedCount;
  const done = weaveRun.verifiedCount;
  return (
    <Link
      to="/$environmentId/weave/$weaveRunId"
      params={{ environmentId, weaveRunId: weaveRun.id }}
      className={cn(
        "flex items-center gap-2 px-3 py-2 border-l-2 border-cyan-500",
        active && "bg-cyan-500/10",
      )}
    >
      <span className="text-cyan-600">◇</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{weaveRun.title}</div>
        <div className="text-xs text-muted-foreground flex gap-2">
          <span>
            {done}/{total}
          </span>
          {weaveRun.failedCount > 0 && (
            <span className="text-red-600">{weaveRun.failedCount} failed</span>
          )}
          {weaveRun.runningCount > 0 && (
            <span className="text-amber-600">{weaveRun.runningCount} running</span>
          )}
        </div>
        <div className="h-1 bg-muted rounded mt-1 overflow-hidden flex">
          <div
            className="bg-green-500"
            style={{ width: `${(done / Math.max(total, 1)) * 100}%` }}
          />
          <div
            className="bg-red-500"
            style={{ width: `${(weaveRun.failedCount / Math.max(total, 1)) * 100}%` }}
          />
        </div>
      </div>
    </Link>
  );
}
