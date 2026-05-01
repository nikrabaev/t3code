"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import type { EnvironmentId, WeaveNodeId, WeaveRunId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "../../lib/utils";
import { useWeaveRunShell, useWeaveRunDetail } from "../../weave/weaveStore";
import { useWeaveRunDetailSubscription } from "../../environments/runtime/service";
import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../../rightPanelLayout";
import { Sheet, SheetPortal } from "../ui/sheet";
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
  const navigate = useNavigate();

  if (!shell) return <div className="p-8 text-muted-foreground">Loading weave run…</div>;

  const inspectorOpen = props.openNodeId !== undefined && detail !== null;
  const blueprint = detail?.currentBlueprint ?? null;
  const isTerminal = shell.status === "complete" || shell.status === "aborted";

  const handleInspectorOpenChange = (open: boolean) => {
    if (!open) {
      void navigate({
        to: "/$environmentId/weave/$weaveRunId",
        params: { environmentId: props.environmentId, weaveRunId: props.weaveRunId },
        search: {},
      });
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_1fr]">
      {/* Left: chat sidebar — placeholder in v0.1 */}
      <aside className="border-r border-border p-4 overflow-y-auto">
        <div className="text-xs text-muted-foreground">Intake conversation (coming in v0.3)</div>
      </aside>

      {/* Center: canvas */}
      <main className="flex flex-col min-w-0 min-h-0 overflow-y-auto">
        <WeaveExecutionHeader
          shell={shell}
          environmentId={props.environmentId}
          onDeleted={() => {
            void navigate({ to: "/", replace: true });
          }}
        />
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
              detail={detail!}
            />
            <WeaveBlueprintList detail={detail!} openNodeId={props.openNodeId} />
          </>
        )}
        {/* Running / paused / terminal-with-blueprint: list only. */}
        {blueprint && shell.status !== "reviewing" && shell.status !== "draft" && (
          <WeaveBlueprintList detail={detail!} openNodeId={props.openNodeId} />
        )}
      </main>

      {/* Inspector overlay — slides over the page; backdrop / ESC dismisses.
          Composed manually (rather than using the shared SheetPopup wrapper) so
          we can pass `forceRender` to the backdrop. base-ui's Dialog.Backdrop
          suppresses itself when ancestor Dialog.Roots exist (e.g. the mobile
          sidebar Sheet) — `forceRender` overrides that and ensures the backdrop
          is visible whenever the inspector is open. */}
      <Sheet open={inspectorOpen} onOpenChange={handleInspectorOpenChange}>
        <SheetPortal>
          <SheetPrimitive.Backdrop
            forceRender
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
          />
          <SheetPrimitive.Viewport className="fixed inset-0 z-50 flex justify-end">
            <SheetPrimitive.Popup
              className={cn(
                "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-popover text-popover-foreground shadow-lg/5 transition-[opacity,translate] duration-200 ease-in-out will-change-transform border-s data-ending-style:translate-x-8 data-ending-style:opacity-0 data-starting-style:translate-x-8 data-starting-style:opacity-0",
                RIGHT_PANEL_SHEET_CLASS_NAME,
              )}
            >
              {detail && props.openNodeId !== undefined && (
                <WeaveInspector
                  environmentId={props.environmentId}
                  weaveRunDetail={detail}
                  openNodeId={props.openNodeId}
                />
              )}
            </SheetPrimitive.Popup>
          </SheetPrimitive.Viewport>
        </SheetPortal>
      </Sheet>
    </div>
  );
}
