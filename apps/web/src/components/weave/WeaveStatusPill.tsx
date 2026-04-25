import type { WeaveNodeStatus } from "@t3tools/contracts";
import { cn } from "../../lib/utils";

export const WEAVE_STATUS_COLOR: Record<WeaveNodeStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  ready: "bg-blue-500/20 text-blue-700",
  running: "bg-amber-500/20 text-amber-700",
  verified: "bg-green-500/20 text-green-700",
  failed: "bg-red-500/20 text-red-700",
  paused: "bg-muted text-muted-foreground",
};

export const WEAVE_STATUS_ICON: Record<WeaveNodeStatus, string> = {
  pending: "○",
  ready: "●",
  running: "⏳",
  verified: "✓",
  failed: "✗",
  paused: "⏸",
};

export function WeaveStatusPill({ status }: { readonly status: WeaveNodeStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs",
        WEAVE_STATUS_COLOR[status],
      )}
    >
      <span aria-hidden>{WEAVE_STATUS_ICON[status]}</span>
      <span className="capitalize">{status}</span>
    </span>
  );
}
