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
  readonly openNodeId?: WeaveNodeId | undefined;
}

export function WeaveView(props: WeaveViewProps) {
  useWeaveRunDetailSubscription(props.environmentId, props.weaveRunId);
  const shell = useWeaveRunShell(props.environmentId, props.weaveRunId);
  const detail = useWeaveRunDetail(props.environmentId, props.weaveRunId);

  if (!shell) return <div className="p-8 text-muted-foreground">Loading weave run…</div>;

  const inspectorOpen = props.openNodeId !== undefined && detail !== null;
  const blueprint = detail?.currentBlueprint ?? null;
  const isTerminal = shell.status === "complete" || shell.status === "aborted";

  return (
    <div
      className={`grid h-full min-h-0 ${
        inspectorOpen ? "grid-cols-[320px_1fr_400px]" : "grid-cols-[320px_1fr]"
      }`}
    >
      {/* Left: chat sidebar — placeholder in v0.1 */}
      <aside className="border-r border-border p-4 overflow-y-auto">
        <div className="text-xs text-muted-foreground">Intake conversation (coming in v0.3)</div>
      </aside>

      {/* Center: canvas */}
      <main className="flex flex-col min-w-0 min-h-0 overflow-y-auto">
        <WeaveExecutionHeader shell={shell} />
        {shell.status === "complete" && (
          <WeaveCompletionBanner environmentId={props.environmentId} weaveRunId={shell.id} />
        )}
        {/* Pre-blueprint states: planner still compiling. */}
        {!blueprint && !isTerminal && <WeaveIntakeView />}
        {/* Terminal-without-blueprint (e.g., run aborted before planner finished). */}
        {!blueprint && isTerminal && (
          <div className="p-8 text-sm text-muted-foreground">
            This Weave run ended ({shell.status}) before a Blueprint was compiled.
          </div>
        )}
        {/* Reviewing: approve callout + list. */}
        {blueprint && shell.status === "reviewing" && (
          <>
            <WeaveApproveCallout
              environmentId={props.environmentId}
              weaveRunId={shell.id}
              blueprint={blueprint}
            />
            <WeaveBlueprintList detail={detail!} openNodeId={props.openNodeId} />
          </>
        )}
        {/* Running / paused / terminal-with-blueprint: list only. */}
        {blueprint && shell.status !== "reviewing" && shell.status !== "draft" && (
          <WeaveBlueprintList detail={detail!} openNodeId={props.openNodeId} />
        )}
      </main>

      {/* Right: inspector — only mount the column when a node is selected. */}
      {inspectorOpen && (
        <aside className="border-l border-border min-h-0 overflow-hidden">
          <WeaveInspector
            environmentId={props.environmentId}
            weaveRunDetail={detail!}
            openNodeId={props.openNodeId!}
          />
        </aside>
      )}
    </div>
  );
}
