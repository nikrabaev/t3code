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

import {
  Scope,
  WeaveContract,
  WeaveDecision,
  WeavePhase,
} from "./weave.ts";

const decodeScope = Schema.decodeUnknownEffect(Scope);
const decodeWeaveContract = Schema.decodeUnknownEffect(WeaveContract);
const decodeWeavePhase = Schema.decodeUnknownEffect(WeavePhase);
const decodeWeaveDecision = Schema.decodeUnknownEffect(WeaveDecision);

it.effect("round-trips a Scope with read/write globs", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeScope({
      readSet: ["src/**/*.ts"],
      writeSet: ["src/feature/**/*.ts"],
    });
    assert.deepStrictEqual(parsed.readSet, ["src/**/*.ts"]);
    assert.deepStrictEqual(parsed.writeSet, ["src/feature/**/*.ts"]);
  }),
);

it.effect("round-trips a WeaveContract without conformanceTestPath", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveContract({
      id: "contract-1",
      ownerNodeId: "node-1",
      surface: "type Foo = { bar: string }",
      semantics: "bar is never empty",
    });
    assert.strictEqual(parsed.id, "contract-1");
    assert.strictEqual(parsed.conformanceTestPath, undefined);
  }),
);

it.effect("round-trips a WeaveContract with conformanceTestPath", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveContract({
      id: "contract-2",
      ownerNodeId: "node-2",
      surface: "{}",
      semantics: "",
      conformanceTestPath: ".weave/contracts/node-2/conformance.test.ts",
    });
    assert.strictEqual(
      parsed.conformanceTestPath,
      ".weave/contracts/node-2/conformance.test.ts",
    );
  }),
);

it.effect("round-trips a WeavePhase with default approval pending", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePhase({
      id: "phase-1",
      ordinal: 0,
      title: "Scaffold",
      description: "Lay down tooling and package layout.",
      approval: "pending",
    });
    assert.strictEqual(parsed.ordinal, 0);
    assert.strictEqual(parsed.approval, "pending");
  }),
);

it.effect("round-trips a WeaveDecision without a resolution", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecision({
      id: "decision-1",
      question: "Pick a state library.",
      options: ["zustand", "jotai", "valtio"],
      blastRadiusNodeIds: ["node-a", "node-b"],
    });
    assert.strictEqual(parsed.resolution, undefined);
    assert.deepStrictEqual(parsed.options, ["zustand", "jotai", "valtio"]);
  }),
);

it.effect("round-trips a WeaveDecision with a user-supplied resolution", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecision({
      id: "decision-2",
      question: "Pick a state library.",
      options: ["zustand", "jotai"],
      blastRadiusNodeIds: [],
      preAuthScope: "library",
      resolution: {
        answer: "jotai",
        byUser: true,
        rationale: "Already in the codebase.",
        resolvedAt: "2026-04-21T12:00:00.000Z",
      },
    });
    assert.strictEqual(parsed.resolution?.answer, "jotai");
    assert.strictEqual(parsed.resolution?.byUser, true);
    assert.strictEqual(parsed.preAuthScope, "library");
  }),
);
