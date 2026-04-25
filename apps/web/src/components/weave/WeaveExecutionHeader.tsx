import type { OrchestrationWeaveRunShell } from "@t3tools/contracts";

export interface WeaveExecutionHeaderProps {
  readonly shell: OrchestrationWeaveRunShell;
}

export function WeaveExecutionHeader({ shell }: WeaveExecutionHeaderProps) {
  const total =
    shell.pendingCount +
    shell.readyCount +
    shell.runningCount +
    shell.verifiedCount +
    shell.failedCount;
  return (
    <header className="border-b border-border flex items-center justify-between gap-4 px-6 py-4 min-w-0">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <h1 className="text-xl font-semibold truncate min-w-0">{shell.title}</h1>
        <span className="text-sm text-muted-foreground shrink-0">{shell.status}</span>
      </div>
      <div className="flex items-center gap-6 text-xs shrink-0">
        <Stat label="Verified" value={shell.verifiedCount} color="text-green-600" />
        <Stat label="Running" value={shell.runningCount} color="text-amber-600" />
        <Stat label="Ready" value={shell.readyCount} color="text-blue-600" />
        <Stat label="Failed" value={shell.failedCount} color="text-red-600" />
        <Stat label="Pending" value={shell.pendingCount} color="text-muted-foreground" />
        <Stat label="Total" value={total} />
        <div className="flex items-center gap-2 border-l border-border pl-6">
          <label className="text-muted-foreground">Concurrency</label>
          <input
            type="range"
            min={1}
            max={1}
            value={1}
            disabled
            className="w-24"
            aria-label="Concurrency cap (locked at 1 in v0.1)"
          />
          <span className="text-muted-foreground">1 (locked)</span>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`font-medium ${color ?? ""}`}>{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}
