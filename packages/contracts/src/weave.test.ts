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

import {
  DecisionPreAuthScope,
  WeaveNodeKind,
  WeaveNodeStatus,
  WeavePhaseApproval,
  WeaveRunStatus,
} from "./weave.ts";

const decodeWeaveRunStatus = Schema.decodeUnknownEffect(WeaveRunStatus);
const decodeWeaveNodeStatus = Schema.decodeUnknownEffect(WeaveNodeStatus);
const decodeWeaveNodeKind = Schema.decodeUnknownEffect(WeaveNodeKind);
const decodeWeavePhaseApproval = Schema.decodeUnknownEffect(WeavePhaseApproval);
const decodeDecisionPreAuthScope = Schema.decodeUnknownEffect(DecisionPreAuthScope);

it.effect("accepts every WeaveRunStatus literal", () =>
  Effect.gen(function* () {
    for (const s of ["draft", "reviewing", "running", "paused", "complete", "aborted"] as const) {
      assert.strictEqual(yield* decodeWeaveRunStatus(s), s);
    }
  }),
);

it.effect("rejects unknown WeaveRunStatus", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeWeaveRunStatus("nope"));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts every WeaveNodeStatus literal", () =>
  Effect.gen(function* () {
    for (const s of ["pending", "ready", "running", "verified", "failed", "paused"] as const) {
      assert.strictEqual(yield* decodeWeaveNodeStatus(s), s);
    }
  }),
);

it.effect("accepts every WeaveNodeKind literal", () =>
  Effect.gen(function* () {
    for (const k of ["raw", "scaffold", "contract", "utility"] as const) {
      assert.strictEqual(yield* decodeWeaveNodeKind(k), k);
    }
  }),
);

it.effect("accepts every WeavePhaseApproval literal", () =>
  Effect.gen(function* () {
    for (const a of ["pending", "approved", "rejected"] as const) {
      assert.strictEqual(yield* decodeWeavePhaseApproval(a), a);
    }
  }),
);

it.effect("accepts every DecisionPreAuthScope literal", () =>
  Effect.gen(function* () {
    for (const s of ["library", "naming", "copy", "auth", "data", "cost"] as const) {
      assert.strictEqual(yield* decodeDecisionPreAuthScope(s), s);
    }
  }),
);
