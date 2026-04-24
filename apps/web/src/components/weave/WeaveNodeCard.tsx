import type { WeaveNode, WeaveNodeStatus } from "@t3tools/contracts";
import { cn } from "../../lib/utils";

const STATUS_COLOR: Record<WeaveNodeStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  ready: "bg-blue-500/20 text-blue-700",
  running: "bg-amber-500/20 text-amber-700",
  verified: "bg-green-500/20 text-green-700",
  failed: "bg-red-500/20 text-red-700",
  paused: "bg-muted text-muted-foreground",
};

const STATUS_ICON: Record<WeaveNodeStatus, string> = {
  pending: "○",
  ready: "●",
  running: "⏳",
  verified: "✓",
  failed: "✗",
  paused: "⏸",
};

export interface WeaveNodeCardProps {
  readonly node: WeaveNode;
  readonly status: WeaveNodeStatus;
  readonly dependsOnStatuses: ReadonlyMap<string, WeaveNodeStatus>;
  readonly selected: boolean;
  readonly onClick: () => void;
}

export function WeaveNodeCard({
  node,
  status,
  dependsOnStatuses,
  selected,
  onClick,
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
          STATUS_COLOR[status],
        )}
      >
        {STATUS_ICON[status]}
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
                {dep} {STATUS_ICON[dependsOnStatuses.get(dep) ?? "pending"]}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
