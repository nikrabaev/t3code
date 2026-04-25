import type { EnvironmentId, WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";
import { CommandId } from "@t3tools/contracts";
import { useState } from "react";
import { isElectron } from "../../env";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "~/lib/utils";
import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";
import ChatView from "../ChatView";
import { Button, buttonVariants } from "../ui/button";
import { WeaveStatusPill } from "./WeaveStatusPill";

export interface WeaveInspectorProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunDetail: WeaveRunProjection;
  readonly openNodeId: WeaveNodeId;
}

export function WeaveInspector({ environmentId, weaveRunDetail, openNodeId }: WeaveInspectorProps) {
  const childThread = weaveRunDetail.childThreads.get(openNodeId);
  const node = weaveRunDetail.currentBlueprint?.nodes.find((n) => n.id === openNodeId) ?? null;
  const meta = weaveRunDetail.nodeMeta.get(openNodeId) ?? null;
  const [retryPending, setRetryPending] = useState(false);

  const handleRetry = async () => {
    if (retryPending || meta?.status !== "failed") return;
    setRetryPending(true);
    try {
      await dispatchWeaveCommand(environmentId, {
        type: "weave.node.retry",
        commandId: CommandId.make(crypto.randomUUID()),
        weaveRunId: weaveRunDetail.run.id,
        nodeId: openNodeId,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setRetryPending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold truncate">{node?.title ?? openNodeId}</h2>
          <WeaveStatusPill status={meta?.status ?? "pending"} />
        </div>
        {node?.description && <p className="text-sm text-muted-foreground">{node.description}</p>}
        {meta?.dispatchedAt && (
          <p className="text-xs text-muted-foreground">
            Dispatched {formatRelativeTimeLabel(meta.dispatchedAt)}
          </p>
        )}
        {meta?.status === "failed" && meta?.failureReason && (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-red-600">Failed: {meta.failureReason}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRetry()}
                disabled={retryPending}
              >
                {retryPending ? "Retrying…" : "Retry verifier"}
              </Button>
            </div>
            {meta?.failureOutput && (
              <details className="group rounded border border-red-600/30 bg-red-600/5">
                <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-red-600/90 hover:text-red-600">
                  <span className="group-open:hidden">Show verifier output</span>
                  <span className="hidden group-open:inline">Hide verifier output</span>
                </summary>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-red-600/20 px-2 py-1 font-mono text-[11px] text-foreground/85">
                  {meta.failureOutput}
                </pre>
              </details>
            )}
          </div>
        )}
        {childThread && (
          <div className="flex gap-2">
            <a
              href={`/${environmentId}/${childThread.threadId}`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Open thread ↗
            </a>
            {isElectron && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => revealInFileManager(childThread.worktreePath)}
              >
                Open worktree
              </Button>
            )}
          </div>
        )}
      </header>
      {childThread ? (
        <ChatView
          environmentId={environmentId}
          threadId={childThread.threadId}
          routeKind="server"
          hideHeader
        />
      ) : (
        <div className="p-4 text-muted-foreground text-sm">
          This node hasn't been dispatched yet.
        </div>
      )}
    </div>
  );
}

function revealInFileManager(path: string): void {
  // Stub for v0.1 — desktop shell only. Web builds no-op.
  console.warn("reveal in file manager not available:", path);
}
