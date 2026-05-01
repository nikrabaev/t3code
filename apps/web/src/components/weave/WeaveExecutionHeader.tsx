import { type EnvironmentId, type OrchestrationWeaveRunShell } from "@t3tools/contracts";
import { useState } from "react";

import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";
import { newCommandId } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";

export interface WeaveExecutionHeaderProps {
  readonly shell: OrchestrationWeaveRunShell;
  readonly environmentId: EnvironmentId;
  readonly onDeleted: () => void;
}

export function WeaveExecutionHeader({
  shell,
  environmentId,
  onDeleted,
}: WeaveExecutionHeaderProps) {
  const total =
    shell.pendingCount +
    shell.readyCount +
    shell.runningCount +
    shell.verifiedCount +
    shell.failedCount;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirmDelete = async () => {
    setSubmitting(true);
    try {
      await dispatchWeaveCommand(environmentId, {
        type: "weave.delete",
        commandId: newCommandId(),
        weaveRunId: shell.id,
        createdAt: new Date().toISOString(),
      });
      setConfirmOpen(false);
      onDeleted();
    } catch (err) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to delete weave",
          description: err instanceof Error ? err.message : "An unknown error occurred.",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

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
        <div className="border-l border-border pl-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete weave"
          >
            Delete weave
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!submitting) setConfirmOpen(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete weave "{shell.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the weave run from your environment. Child threads created by the weave
              (planner, dispatched nodes) will remain and must be deleted separately if you no
              longer need them. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={submitting}
              render={<Button variant="outline" disabled={submitting} />}
            >
              Cancel
            </AlertDialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={submitting}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
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
