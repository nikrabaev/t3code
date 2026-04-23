import type {
  Blueprint,
  OrchestrationEvent,
  WeaveCommand,
  WeaveNodeId,
  WeaveNodeStatus,
  WeavePhaseId,
  WeaveRunId,
} from "@t3tools/contracts";
import { EventId } from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  requireAncestorsVerified,
  requireBlueprintVersion,
  requireNode,
  requireNodeStatus,
  requireRun,
  requireRunAbsent,
  requireRunNotTerminal,
  requireStatus,
} from "./weaveCommandInvariants.ts";
import type { WeaveRunProjection } from "./weaveProjector.ts";

// PlannedWeaveEvent: a weave-aggregate OrchestrationEvent minus `sequence`
// (the engine assigns sequence at persistence time). All other envelope fields
// are produced by the decider.
//
// Using a distributive Omit so the discriminated union is preserved:
// `Omit<A | B, K>` would collapse the union; `DistributiveOmit` applies
// Omit to each member individually, keeping the discriminant intact.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type PlannedWeaveEvent = DistributiveOmit<
  Extract<OrchestrationEvent, { readonly type: `weave.${string}` }>,
  "sequence"
>;

type WeaveEventType = PlannedWeaveEvent["type"];

function envelope<T extends WeaveEventType>(input: {
  readonly type: T;
  readonly weaveRunId: WeaveRunId;
  readonly occurredAt: string;
  readonly commandId: WeaveCommand["commandId"];
  readonly payload: unknown;
}): Extract<PlannedWeaveEvent, { type: T }> {
  const base = {
    eventId: EventId.make(crypto.randomUUID()),
    aggregateKind: "weave" as const,
    aggregateId: input.weaveRunId,
    type: input.type,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: {},
    payload: input.payload,
  };
  return base as unknown as Extract<PlannedWeaveEvent, { type: T }>;
}

function isPhaseNowComplete(
  blueprint: Blueprint,
  nodeStatuses: ReadonlyMap<WeaveNodeId, WeaveNodeStatus>,
  phaseId: WeavePhaseId,
  justVerifiedNodeId: WeaveNodeId,
): boolean {
  const phaseNodes = blueprint.nodes.filter((n) => n.phaseId === phaseId);
  return phaseNodes.every((n) =>
    n.id === justVerifiedNodeId ? true : nodeStatuses.get(n.id) === "verified",
  );
}

function isLastPhase(blueprint: Blueprint, phaseId: WeavePhaseId): boolean {
  const maxOrdinal = Math.max(...blueprint.phases.map((p) => p.ordinal));
  const phase = blueprint.phases.find((p) => p.id === phaseId);
  return phase !== undefined && phase.ordinal === maxOrdinal;
}

export function decideWeaveCommand(input: {
  readonly projection: WeaveRunProjection | null;
  readonly command: WeaveCommand;
}): Effect.Effect<ReadonlyArray<PlannedWeaveEvent>, OrchestrationCommandInvariantError> {
  const { projection, command } = input;

  switch (command.type) {
    case "weave.create": {
      return Effect.gen(function* () {
        yield* requireRunAbsent({ projection, command });
        return [
          envelope({
            type: "weave.created",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              projectId: command.projectId,
              title: command.title,
              vision: command.vision,
              ...(command.parentThreadId !== undefined && {
                parentThreadId: command.parentThreadId,
              }),
              ...(command.parentMessageId !== undefined && {
                parentMessageId: command.parentMessageId,
              }),
              ...(command.snapshotContent !== undefined && {
                snapshotContent: command.snapshotContent,
              }),
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    case "weave.blueprint.compile": {
      return Effect.gen(function* () {
        const run = yield* requireRun({ projection, command });
        const allowed =
          command.reason === "initial" ? (["draft"] as const) : (["running", "reviewing"] as const);
        yield* requireStatus({ projection: run, command, allowed });
        return []; // Planner emits the event; decider only validates.
      });
    }
    case "weave.blueprint.approve": {
      return Effect.gen(function* () {
        const run = yield* requireRun({ projection, command });
        yield* requireStatus({ projection: run, command, allowed: ["reviewing"] });
        yield* requireBlueprintVersion({
          projection: run,
          command,
          version: command.blueprintVersion,
        });
        return [
          envelope({
            type: "weave.blueprint-approved",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              version: command.blueprintVersion,
              concurrencyCap: command.concurrencyCap,
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    case "weave.exit": {
      return Effect.gen(function* () {
        const run = yield* requireRun({ projection, command });
        yield* requireRunNotTerminal({ projection: run, command });
        return [
          envelope({
            type: "weave.exited",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              reason: command.reason,
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    case "weave.node.dispatch": {
      return Effect.gen(function* () {
        const run = yield* requireRun({ projection, command });
        yield* requireStatus({ projection: run, command, allowed: ["running"] });
        yield* requireNodeStatus({
          projection: run,
          command,
          nodeId: command.nodeId,
          allowed: ["ready"],
        });
        const node = yield* requireNode({ projection: run, command, nodeId: command.nodeId });
        yield* requireAncestorsVerified({ projection: run, command, node });
        return [
          envelope({
            type: "weave.node-dispatched",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              nodeId: command.nodeId,
              childThreadId: command.childThreadId,
              worktreePath: command.worktreePath,
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    case "weave.node.verified": {
      return Effect.gen(function* () {
        const run = yield* requireRun({ projection, command });
        yield* requireStatus({ projection: run, command, allowed: ["running"] });
        yield* requireNodeStatus({
          projection: run,
          command,
          nodeId: command.nodeId,
          allowed: ["running"],
        });
        if (command.verifierOutcome.trim().length === 0) {
          return yield* Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `verifierOutcome must be non-empty.`,
            }),
          );
        }
        const node = yield* requireNode({ projection: run, command, nodeId: command.nodeId });
        const results: PlannedWeaveEvent[] = [
          envelope({
            type: "weave.node-verified",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              nodeId: command.nodeId,
              verifierOutcome: command.verifierOutcome,
              occurredAt: command.createdAt,
            },
          }),
        ];
        const bp = run.currentBlueprint;
        if (bp !== null && isPhaseNowComplete(bp, run.nodeStatuses, node.phaseId, command.nodeId)) {
          results.push(
            envelope({
              type: "weave.phase-approved",
              weaveRunId: command.weaveRunId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
              payload: {
                weaveRunId: command.weaveRunId,
                phaseId: node.phaseId,
                approval: "approved",
                occurredAt: command.createdAt,
              },
            }),
          );
          if (isLastPhase(bp, node.phaseId)) {
            results.push(
              envelope({
                type: "weave.exited",
                weaveRunId: command.weaveRunId,
                occurredAt: command.createdAt,
                commandId: command.commandId,
                payload: {
                  weaveRunId: command.weaveRunId,
                  reason: "complete",
                  occurredAt: command.createdAt,
                },
              }),
            );
          }
        }
        return results;
      });
    }
    case "weave.node.failed": {
      return Effect.gen(function* () {
        const run = yield* requireRun({ projection, command });
        yield* requireStatus({ projection: run, command, allowed: ["running"] });
        yield* requireNodeStatus({
          projection: run,
          command,
          nodeId: command.nodeId,
          allowed: ["running"],
        });
        return [
          envelope({
            type: "weave.node-failed",
            weaveRunId: command.weaveRunId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
            payload: {
              weaveRunId: command.weaveRunId,
              nodeId: command.nodeId,
              reason: command.reason,
              occurredAt: command.createdAt,
            },
          }),
        ];
      });
    }
    // Placeholder for Tasks 7–9.
    default: {
      return Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Decider does not yet handle '${command.type}' (pending Slice 2 tasks).`,
        }),
      );
    }
  }
}
