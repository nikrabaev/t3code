"use client";

import type { Blueprint, EnvironmentId, WeaveRunId, WeaveRunProjection } from "@t3tools/contracts";
import { BlueprintVersion, CommandId } from "@t3tools/contracts";
import { useEffect } from "react";
import { Button } from "../ui/button";
import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";

export interface WeaveApproveCalloutProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly blueprint: Blueprint;
  readonly detail: WeaveRunProjection;
}

interface CalloutCopy {
  readonly headline: string;
  readonly subhead: string | null;
  readonly tiles: ReadonlyArray<{ label: string; value: number | string }>;
}

/**
 * Compute the headline + tiles for the approve callout based on what kind of
 * compile the user is being asked to approve.
 *
 * - "planner": initial intake gate. Show full Blueprint counts.
 * - "phase-planning": a Phase Planner just emitted. Show that Phase's title
 *   in the headline + a delta count of newly-added Tasks.
 * - "amendment" / "redesign": catch-all "Approve plan update". Use the full
 *   Blueprint counts; future slices will refine the copy.
 */
function buildCalloutCopy(blueprint: Blueprint, detail: WeaveRunProjection): CalloutCopy {
  const phaseCount = blueprint.phases.length;
  const nodeCount = blueprint.nodes.length;
  const contractCount = blueprint.contracts?.length ?? 0;
  const estWallTime = "≈ 10–30 min"; // v0.1 placeholder per spec §4.6

  if (blueprint.compiledBy === "phase-planning") {
    // Find the most-recently-verified Planning Node — its phase is the one
    // the user is being asked to approve.
    let mostRecent: { plannerNode: (typeof blueprint.nodes)[number]; verifiedAt: string } | null =
      null;
    for (const node of blueprint.nodes) {
      if (node.kind !== "planning") continue;
      const meta = detail.nodeMeta.get(node.id);
      if (meta?.status !== "verified" || meta.verifiedAt === undefined) continue;
      if (mostRecent === null || meta.verifiedAt > mostRecent.verifiedAt) {
        mostRecent = { plannerNode: node, verifiedAt: meta.verifiedAt };
      }
    }
    if (mostRecent !== null) {
      const phase = blueprint.phases.find((p) => p.id === mostRecent.plannerNode.phaseId);
      const phaseTitle = phase?.title ?? "Phase";
      // Delta = nodes in this phase, excluding the planner itself.
      const newTaskCount = blueprint.nodes.filter(
        (n) => n.phaseId === mostRecent.plannerNode.phaseId && n.id !== mostRecent.plannerNode.id,
      ).length;
      return {
        headline: `Approve ${phaseTitle} plan`,
        subhead: `${newTaskCount} new ${newTaskCount === 1 ? "Task" : "Tasks"} added since last approval.`,
        tiles: [
          { label: "Phase", value: phaseTitle },
          { label: "New Tasks", value: newTaskCount },
          { label: "Total Phases", value: phaseCount },
          { label: "Est. wall time", value: estWallTime },
        ],
      };
    }
    // Fall through to the generic "plan update" copy if we can't identify
    // the phase (shouldn't happen — `phase-planning` always pairs with a
    // verified planner node — but this keeps the UI safe).
  }

  if (blueprint.compiledBy === "amendment" || blueprint.compiledBy === "redesign") {
    return {
      headline: "Approve plan update",
      subhead: null,
      tiles: [
        { label: "Phases", value: phaseCount },
        { label: "Nodes", value: nodeCount },
        { label: "Contracts", value: contractCount },
        { label: "Est. wall time", value: estWallTime },
      ],
    };
  }

  // Default: "planner" (initial compile).
  return {
    headline: "Approve & run",
    subhead: null,
    tiles: [
      { label: "Phases", value: phaseCount },
      { label: "Nodes", value: nodeCount },
      { label: "Contracts", value: contractCount },
      { label: "Est. wall time", value: estWallTime },
    ],
  };
}

export function WeaveApproveCallout({
  environmentId,
  weaveRunId,
  blueprint,
  detail,
}: WeaveApproveCalloutProps) {
  const copy = buildCalloutCopy(blueprint, detail);

  const handleApprove = async () => {
    await dispatchWeaveCommand(environmentId, {
      type: "weave.blueprint.approve",
      commandId: CommandId.make(crypto.randomUUID()),
      weaveRunId,
      blueprintVersion: BlueprintVersion.make(blueprint.version),
      concurrencyCap: 1, // v0.1 locked
      createdAt: new Date().toISOString(),
    });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleApprove();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleApprove]);

  return (
    <div className="px-6 py-4 border-b border-border bg-cyan-500/5">
      <div className="mb-3">
        <h2 className="text-base font-semibold">{copy.headline}</h2>
        {copy.subhead !== null && (
          <p className="text-sm text-muted-foreground mt-1">{copy.subhead}</p>
        )}
      </div>
      <div className="grid grid-cols-4 gap-4 mb-4">
        {copy.tiles.map((tile) => (
          <Tile key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </div>
      <div className="flex gap-3">
        <Button onClick={() => void handleApprove()}>Approve & run (⌘↵)</Button>
        <Button variant="outline" disabled title="Direct-edit ships in v0.3">
          Edit Blueprint
        </Button>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center p-3 bg-background rounded border border-border">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
