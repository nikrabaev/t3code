"use client";

import type { EnvironmentId, WeaveNodeId, WeaveRunId } from "@t3tools/contracts";
import { useWeaveRunShell, useWeaveRunDetail } from "../../weave/weaveStore";
import { useWeaveRunDetailSubscription } from "../../environments/runtime/service";
import { WeaveIntakeView } from "./WeaveIntakeView";
import { WeaveBlueprintList } from "./WeaveBlueprintList";
import { WeaveInspector } from "./WeaveInspector";
import { WeaveExecutionHeader } from "./WeaveExecutionHeader";
import { WeaveApproveCallout } from "./WeaveApproveCallout";
import { WeaveCompletionBanner } from "./WeaveCompletionBanner";

export interface WeaveViewProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly openNodeId?: WeaveNodeId;
}

export function WeaveView(props: WeaveViewProps) {
  useWeaveRunDetailSubscription(props.environmentId, props.weaveRunId);
  const shell = useWeaveRunShell(props.environmentId, props.weaveRunId);
  const detail = useWeaveRunDetail(props.environmentId, props.weaveRunId);

  if (!shell) return <div className="p-8 text-muted-foreground">Loading weave run…</div>;

  return (
    <div className="grid grid-cols-[320px_1fr_400px] h-full">
      {/* Left: chat sidebar — placeholder in v0.1 */}
      <aside className="border-r border-border p-4">
        <div className="text-xs text-muted-foreground">Intake conversation (coming in v0.3)</div>
      </aside>

      {/* Center: canvas */}
      <main className="flex flex-col overflow-y-auto">
        <WeaveExecutionHeader shell={shell} />
        {shell.status === "complete" && (
          <WeaveCompletionBanner environmentId={props.environmentId} weaveRunId={shell.id} />
        )}
        {shell.status === "draft" && <WeaveIntakeView />}
        {shell.status === "reviewing" && detail?.currentBlueprint && (
          <>
            <WeaveApproveCallout
              environmentId={props.environmentId}
              weaveRunId={shell.id}
              blueprint={detail.currentBlueprint}
            />
            <WeaveBlueprintList detail={detail} openNodeId={props.openNodeId} />
          </>
        )}
        {(shell.status === "running" ||
          shell.status === "paused" ||
          shell.status === "complete" ||
          shell.status === "aborted") &&
          detail?.currentBlueprint && (
            <WeaveBlueprintList detail={detail} openNodeId={props.openNodeId} />
          )}
      </main>

      {/* Right: inspector */}
      <aside className="border-l border-border">
        {props.openNodeId && detail && (
          <WeaveInspector
            environmentId={props.environmentId}
            weaveRunDetail={detail}
            openNodeId={props.openNodeId}
          />
        )}
      </aside>
    </div>
  );
}
