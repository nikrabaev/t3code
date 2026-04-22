import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BlueprintVersion,
  WeaveContractId,
  WeaveDecisionId,
  WeaveNodeId,
  WeavePhaseId,
  WeaveRunId,
} from "./weave.ts";

const decodeWeaveRunId = Schema.decodeUnknownEffect(WeaveRunId);
const decodeWeaveNodeId = Schema.decodeUnknownEffect(WeaveNodeId);
const decodeWeaveContractId = Schema.decodeUnknownEffect(WeaveContractId);
const decodeWeavePhaseId = Schema.decodeUnknownEffect(WeavePhaseId);
const decodeWeaveDecisionId = Schema.decodeUnknownEffect(WeaveDecisionId);
const decodeBlueprintVersion = Schema.decodeUnknownEffect(BlueprintVersion);

it.effect("trims and brands WeaveRunId", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRunId("  run-1  ");
    assert.strictEqual(parsed, "run-1");
  }),
);

it.effect("rejects empty WeaveRunId after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeWeaveRunId("   "));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts a non-negative integer BlueprintVersion", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBlueprintVersion(1);
    assert.strictEqual(parsed, 1);
  }),
);

it.effect("brands the other weave ids", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* decodeWeaveNodeId("node-1"), "node-1");
    assert.strictEqual(yield* decodeWeaveContractId("contract-1"), "contract-1");
    assert.strictEqual(yield* decodeWeavePhaseId("phase-1"), "phase-1");
    assert.strictEqual(yield* decodeWeaveDecisionId("decision-1"), "decision-1");
  }),
);
