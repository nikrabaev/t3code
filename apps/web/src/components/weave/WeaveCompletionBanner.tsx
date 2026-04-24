import type { EnvironmentId, WeaveRunId } from "@t3tools/contracts";

export interface WeaveCompletionBannerProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
}

export function WeaveCompletionBanner({
  environmentId: _environmentId,
  weaveRunId: _weaveRunId,
}: WeaveCompletionBannerProps) {
  return (
    <div className="px-6 py-4 border-b border-border bg-green-500/10 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="text-2xl">✓</div>
        <div>
          <div className="font-semibold">Weave complete.</div>
          <div className="text-sm text-muted-foreground">All nodes verified.</div>
        </div>
      </div>
      {/* Link back to parent chat — requires tracking `parentThreadId` on the run.
          v0.1 projection includes parentThreadId; read it from detail. */}
    </div>
  );
}
