import type { EnvironmentId, WeaveNodeId, WeaveRunProjection } from "@t3tools/contracts";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { buttonVariants } from "../ui/button";
import { isElectron } from "../../env";
import { cn } from "~/lib/utils";

export interface WeaveInspectorProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunDetail: WeaveRunProjection;
  readonly openNodeId: WeaveNodeId;
}

export function WeaveInspector({ environmentId, weaveRunDetail, openNodeId }: WeaveInspectorProps) {
  const childThread = weaveRunDetail.childThreads.get(openNodeId);
  if (!childThread) {
    return (
      <div className="p-4 text-muted-foreground text-sm">This node hasn't been dispatched yet.</div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="text-sm font-medium">Node: {openNodeId}</div>
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
      </header>
      <div className="flex-1 overflow-hidden">
        <ChatView
          environmentId={environmentId}
          threadId={childThread.threadId}
          routeKind="server"
        />
      </div>
    </div>
  );
}

function revealInFileManager(path: string): void {
  // Stub for v0.1 — desktop shell only. Web builds no-op.
  console.warn("reveal in file manager not available:", path);
}
