/**
 * RuntimeReceiptBus layers.
 *
 * Both `RuntimeReceiptBusLive` and `RuntimeReceiptBusTest` use the same
 * PubSub-backed implementation. Production needs broadcast so that the
 * WeaveContractConformer receives `turn.processing.quiesced` receipts emitted
 * by CheckpointReactor. `RuntimeReceiptBusTest` is kept as an alias for
 * call-site compatibility; renaming is a separate cleanup task.
 *
 * @module RuntimeReceiptBus
 */
import { Effect, Layer, PubSub, Stream } from "effect";

import {
  RuntimeReceiptBus,
  type RuntimeReceiptBusShape,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";

// Unify the Live and Test implementations — production needs broadcast so the
// WeaveContractConformer receives turn.processing.quiesced receipts from
// CheckpointReactor.
const makeRuntimeReceiptBus = Effect.gen(function* () {
  const pubSub = yield* PubSub.unbounded<OrchestrationRuntimeReceipt>();

  return {
    publish: (receipt) => PubSub.publish(pubSub, receipt).pipe(Effect.asVoid),
    get streamEventsForTest() {
      return Stream.fromPubSub(pubSub);
    },
  } satisfies RuntimeReceiptBusShape;
});

export const RuntimeReceiptBusLive = Layer.effect(RuntimeReceiptBus, makeRuntimeReceiptBus);
// Historical alias — `RuntimeReceiptBusTest` is identical to Live now that
// production also broadcasts. Kept for call-site compatibility.
export const RuntimeReceiptBusTest = RuntimeReceiptBusLive;
