import type { WeaveNode, WeaveNodeMeta, WeaveNodeStatus } from "@t3tools/contracts";
import { cn } from "../../lib/utils";
import { formatElapsedClock } from "../../timestampFormat";
import { WEAVE_STATUS_COLOR, WEAVE_STATUS_ICON } from "./WeaveStatusPill";

export interface WeaveNodeCardProps {
  readonly node: WeaveNode;
  readonly status: WeaveNodeStatus;
  readonly meta: WeaveNodeMeta | null;
  readonly now: number;
  readonly dependsOnStatuses: ReadonlyMap<string, WeaveNodeStatus>;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly latestMessage?: string | null;
}

export function WeaveNodeCard({
  node,
  status,
  meta,
  now,
  dependsOnStatuses,
  selected,
  onClick,
  latestMessage,
}: WeaveNodeCardProps) {
  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 border-l-4 text-left",
        selected ? "border-cyan-500 bg-cyan-500/5" : "border-transparent hover:bg-muted/50",
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded text-xs",
          WEAVE_STATUS_COLOR[status],
        )}
      >
        {WEAVE_STATUS_ICON[status]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{node.title}</div>
        {node.dependsOn.length > 0 && (
          <div className="text-xs text-muted-foreground flex gap-1 flex-wrap mt-1">
            {node.dependsOn.map((dep) => (
              <span
                key={dep}
                className="inline-block border border-muted-foreground/30 rounded px-1.5 py-0.5 text-[10px]"
              >
                {dep} {WEAVE_STATUS_ICON[dependsOnStatuses.get(dep) ?? "pending"]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground shrink-0 max-w-[40%] text-right">
        {status === "failed" && meta?.failureReason && (
          <span className="text-red-600 truncate">{meta.failureReason}</span>
        )}
        {status === "running" && latestMessage && (
          <span className="block text-xs text-muted-foreground italic truncate">
            {latestMessage}
          </span>
        )}
        {status === "running" && meta?.dispatchedAt && (
          <span className="block">
            {formatElapsedClock(now - new Date(meta.dispatchedAt).getTime())}
          </span>
        )}
        {status === "verified" && meta?.verifiedAt && meta?.dispatchedAt && (
          <span>
            {formatElapsedClock(
              new Date(meta.verifiedAt).getTime() - new Date(meta.dispatchedAt).getTime(),
            )}
          </span>
        )}
      </div>
    </button>
  );
}
