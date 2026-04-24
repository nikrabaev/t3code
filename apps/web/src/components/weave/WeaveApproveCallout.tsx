"use client";

import type { Blueprint, EnvironmentId, WeaveRunId } from "@t3tools/contracts";
import { BlueprintVersion, CommandId } from "@t3tools/contracts";
import { useEffect } from "react";
import { Button } from "../ui/button";
import { dispatchWeaveCommand } from "../../weave/dispatchWeaveCommand";

export interface WeaveApproveCalloutProps {
  readonly environmentId: EnvironmentId;
  readonly weaveRunId: WeaveRunId;
  readonly blueprint: Blueprint;
}

export function WeaveApproveCallout({
  environmentId,
  weaveRunId,
  blueprint,
}: WeaveApproveCalloutProps) {
  const phaseCount = blueprint.phases.length;
  const nodeCount = blueprint.nodes.length;
  const extractionCount = blueprint.contracts?.length ?? 0;
  const estWallTime = "≈ 10–30 min"; // v0.1 placeholder per spec §4.6

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
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Tile label="Phases" value={phaseCount} />
        <Tile label="Nodes" value={nodeCount} />
        <Tile label="Contracts" value={extractionCount} />
        <Tile label="Est. wall time" value={estWallTime} />
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
