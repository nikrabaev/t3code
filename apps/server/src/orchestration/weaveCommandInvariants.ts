import type {
  BlueprintVersion,
  WeaveCommand,
  WeaveDecisionId,
  WeaveNode,
  WeaveNodeId,
  WeaveNodeStatus,
  WeavePhaseId,
  WeaveRunStatus,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import type { WeaveRunProjection } from "./weaveProjector.ts";

function fail(command: WeaveCommand, detail: string) {
  return Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail,
    }),
  );
}

// Run existence

export function requireRunAbsent(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.projection === null) return Effect.void;
  return fail(
    input.command,
    `weave run '${input.projection.run.id}' already exists and cannot be created twice.`,
  );
}

export function requireRun(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<WeaveRunProjection, OrchestrationCommandInvariantError> {
  if (input.projection !== null) return Effect.succeed(input.projection);
  return fail(input.command, `weave run does not exist for command '${input.command.type}'.`);
}

export function requireStatus(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly allowed: ReadonlyArray<WeaveRunStatus>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.allowed.includes(input.projection.run.status)) return Effect.void;
  return fail(
    input.command,
    `weave run status is '${input.projection.run.status}'; expected one of [${input.allowed.join(", ")}].`,
  );
}

export function requireRunNotTerminal(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const s = input.projection.run.status;
  if (s === "complete" || s === "aborted") {
    return fail(input.command, `weave run already terminated (status='${s}').`);
  }
  return Effect.void;
}

// Blueprint

export function requireBlueprintVersion(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly version: BlueprintVersion;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.projection.run.currentBlueprintVersion === input.version) return Effect.void;
  return fail(
    input.command,
    `blueprint version mismatch: run has '${input.projection.run.currentBlueprintVersion ?? "none"}', command references '${input.version}'.`,
  );
}

// Node

export function requireNode(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly nodeId: WeaveNodeId;
}): Effect.Effect<WeaveNode, OrchestrationCommandInvariantError> {
  const bp = input.projection.currentBlueprint;
  if (bp === null) {
    return fail(input.command, `weave run has no current blueprint; no nodes to address.`);
  }
  const node = bp.nodes.find((n) => n.id === input.nodeId);
  if (node !== undefined) return Effect.succeed(node);
  return fail(
    input.command,
    `node '${input.nodeId}' not found in current blueprint (v${bp.version}).`,
  );
}

export function requireNodeStatus(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly nodeId: WeaveNodeId;
  readonly allowed: ReadonlyArray<WeaveNodeStatus>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const actual = input.projection.nodeStatuses.get(input.nodeId);
  if (actual !== undefined && input.allowed.includes(actual)) return Effect.void;
  return fail(
    input.command,
    `node '${input.nodeId}' status is '${actual ?? "unknown"}'; expected one of [${input.allowed.join(", ")}].`,
  );
}

// Decision

export function requireOpenDecision(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly decisionId: WeaveDecisionId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.projection.openDecisions.has(input.decisionId)) return Effect.void;
  return fail(
    input.command,
    `decision '${input.decisionId}' is not open (either unknown or already resolved).`,
  );
}

// Phase

export function requirePhasePending(input: {
  readonly projection: WeaveRunProjection;
  readonly command: WeaveCommand;
  readonly phaseId: WeavePhaseId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const approval = input.projection.phaseApprovals.get(input.phaseId) ?? "pending";
  if (approval === "pending") return Effect.void;
  return fail(
    input.command,
    `phase '${input.phaseId}' has approval '${approval}'; expected 'pending'.`,
  );
}
