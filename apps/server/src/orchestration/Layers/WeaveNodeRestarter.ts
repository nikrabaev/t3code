/**
 * WeaveNodeRestarterLive - Layer implementation of WeaveNodeRestarter.
 *
 * Subscribes to `weave.node-restart-requested` events. For each event:
 *
 *  1. Resolves the existing child thread + worktree from the read model.
 *  2. Looks up the full `WeaveNode` from the run's blueprint.
 *  3. Dispatches a new `thread.turn.start` on the existing child thread, with
 *     the same prompt the WeaveScheduler uses on initial dispatch:
 *     `formatPlanningNodeSpec` for `kind: "planning"` nodes,
 *     `formatNodeSpec` for everything else. The worktree is reused; no new
 *     git operations.
 *  4. The verifier runs automatically when the new turn quiesces — handled by
 *     WeaveContractConformer's existing session-ready trigger.
 *
 * @module WeaveNodeRestarterLive
 */
import { CommandId, MessageId, type WeaveNodeId, type WeaveRunId } from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { WeaveEngineService } from "../Services/WeaveEngine.ts";
import {
  WeaveNodeRestarter,
  type WeaveNodeRestarterShape,
} from "../Services/WeaveNodeRestarter.ts";
import { formatNodeSpec, formatPlanningNodeSpec } from "./WeaveScheduler.ts";

const serverCommandId = (): CommandId => CommandId.make(`server:restarter:${crypto.randomUUID()}`);

interface RestartTrigger {
  readonly weaveRunId: WeaveRunId;
  readonly nodeId: WeaveNodeId;
}

const make = Effect.gen(function* () {
  const weaveEngine = yield* WeaveEngineService;
  const orchestrationEngine = yield* OrchestrationEngineService;

  const processItem = (trigger: RestartTrigger) =>
    Effect.gen(function* () {
      const run = yield* weaveEngine.getWeaveRun(trigger.weaveRunId);
      if (run === null) {
        yield* Effect.logWarning("WeaveNodeRestarter: run not found", trigger);
        return;
      }
      const blueprint = run.currentBlueprint;
      const child = run.childThreads.get(trigger.nodeId);
      const node = blueprint?.nodes.find((n) => n.id === trigger.nodeId) ?? null;
      if (!child || node === null || blueprint === null) {
        yield* Effect.logWarning("WeaveNodeRestarter: child thread, node, or blueprint not found", {
          ...trigger,
          hasChild: child !== undefined,
          hasNode: node !== null,
          hasBlueprint: blueprint !== null,
        });
        return;
      }

      yield* Effect.log("WeaveNodeRestarter: re-dispatching agent", {
        weaveRunId: trigger.weaveRunId,
        nodeId: trigger.nodeId,
        childThreadId: child.threadId,
        worktreePath: child.worktreePath,
        nodeKind: node.kind,
      });

      // Planning Nodes get the same structured Phase Planner prompt the
      // scheduler uses on initial dispatch; Tasks keep the generic node spec.
      const messageText =
        node.kind === "planning"
          ? formatPlanningNodeSpec(node, blueprint, run.run)
          : formatNodeSpec(node);

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId(),
        threadId: child.threadId,
        message: {
          messageId: MessageId.make(crypto.randomUUID()),
          role: "user",
          text: messageText,
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: new Date().toISOString(),
      });
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logError("WeaveNodeRestarter: unexpected error processing trigger", {
          trigger,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processItem);

  const start: WeaveNodeRestarterShape["start"] = () =>
    Effect.forkScoped(
      Stream.runForEach(
        weaveEngine.streamWeaveEvents.pipe(
          Stream.filter((e) => e.type === "weave.node-restart-requested"),
        ),
        (event) =>
          event.type === "weave.node-restart-requested"
            ? worker.enqueue({
                weaveRunId: event.payload.weaveRunId,
                nodeId: event.payload.nodeId,
              })
            : Effect.void,
      ),
    ).pipe(Effect.asVoid);

  return {
    start,
    drain: worker.drain,
  } satisfies WeaveNodeRestarterShape;
});

export const WeaveNodeRestarterLive = Layer.effect(WeaveNodeRestarter, make);
