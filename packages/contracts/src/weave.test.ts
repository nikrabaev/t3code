import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BlueprintVersion,
  WeaveBlueprintApproveCommand,
  WeaveContractId,
  WeaveCreateCommand,
  WeaveDecisionId,
  WeaveDecisionResolveCommand,
  WeaveDispatchableCommand,
  WeaveExitCommand,
  WeaveNodeId,
  WeavePhaseApproveCommand,
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
    for (const k of ["raw", "scaffold", "contract", "utility", "planning"] as const) {
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

import { Scope, WeaveContract, WeaveDecision, WeavePhase } from "./weave.ts";

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
    assert.strictEqual(parsed.conformanceTestPath, ".weave/contracts/node-2/conformance.test.ts");
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

import { WeaveNode } from "./weave.ts";

const decodeWeaveNode = Schema.decodeUnknownEffect(WeaveNode);

it.effect("round-trips a minimal pending WeaveNode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNode({
      id: "node-1",
      title: "Scaffold server package",
      description: "Create apps/server skeleton.",
      kind: "scaffold",
      phaseId: "phase-1",
      scope: { readSet: ["**/*.ts"], writeSet: ["apps/server/src/**"] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "Typecheck passes.",
      dependsOn: [],
      status: "pending",
    });
    assert.strictEqual(parsed.kind, "scaffold");
    assert.strictEqual(parsed.status, "pending");
    assert.strictEqual(parsed.advisoryDeps, undefined);
    assert.strictEqual(parsed.childThreadId, undefined);
    assert.strictEqual(parsed.worktreePath, undefined);
    assert.strictEqual(parsed.failureNote, undefined);
  }),
);

it.effect("round-trips a running WeaveNode with child-thread metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNode({
      id: "node-2",
      title: "Implement auth",
      description: "",
      kind: "raw",
      phaseId: "phase-2",
      scope: { readSet: [], writeSet: ["apps/server/src/auth/**"] },
      inputContractIds: ["contract-1"],
      outputContractIds: [],
      verifierDescription: "bun run test passes.",
      dependsOn: ["node-1"],
      advisoryDeps: ["node-0"],
      status: "running",
      childThreadId: "thread-abc",
      worktreePath: "/tmp/wt/node-2",
    });
    assert.deepStrictEqual(parsed.dependsOn, ["node-1"]);
    assert.deepStrictEqual(parsed.advisoryDeps, ["node-0"]);
    assert.strictEqual(parsed.childThreadId, "thread-abc");
    assert.strictEqual(parsed.worktreePath, "/tmp/wt/node-2");
  }),
);

it.effect("round-trips a failed WeaveNode with a failureNote", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNode({
      id: "node-3",
      title: "Broken",
      description: "",
      kind: "raw",
      phaseId: "phase-1",
      scope: { readSet: [], writeSet: [] },
      inputContractIds: [],
      outputContractIds: [],
      verifierDescription: "",
      dependsOn: [],
      status: "failed",
      failureNote: "Contract amendment needed.",
    });
    assert.strictEqual(parsed.failureNote, "Contract amendment needed.");
  }),
);

import { Blueprint } from "./weave.ts";

const decodeBlueprint = Schema.decodeUnknownEffect(Blueprint);

it.effect("round-trips a Blueprint with one phase, one node, zero contracts/decisions", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBlueprint({
      version: 1,
      nodes: [
        {
          id: "node-1",
          title: "Scaffold",
          description: "",
          kind: "scaffold",
          phaseId: "phase-1",
          scope: { readSet: [], writeSet: [] },
          inputContractIds: [],
          outputContractIds: [],
          verifierDescription: "",
          dependsOn: [],
          status: "pending",
        },
      ],
      phases: [
        {
          id: "phase-1",
          ordinal: 0,
          title: "Foundations",
          description: "",
          approval: "pending",
        },
      ],
      contracts: [],
      decisions: [],
      compiledAt: "2026-04-21T00:00:00.000Z",
      compiledBy: "planner",
    });
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.nodes.length, 1);
    assert.strictEqual(parsed.phases.length, 1);
    assert.strictEqual(parsed.compiledBy, "planner");
  }),
);

it.effect("accepts every Blueprint.compiledBy literal", () =>
  Effect.gen(function* () {
    for (const source of ["planner", "amendment", "redesign"] as const) {
      const parsed = yield* decodeBlueprint({
        version: 2,
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: "2026-04-21T00:00:00.000Z",
        compiledBy: source,
      });
      assert.strictEqual(parsed.compiledBy, source);
    }
  }),
);

it.effect("rejects an unknown Blueprint.compiledBy", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeBlueprint({
        version: 1,
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: "2026-04-21T00:00:00.000Z",
        compiledBy: "user", // not in the literal set
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

import { WeaveRun } from "./weave.ts";

const decodeWeaveRun = Schema.decodeUnknownEffect(WeaveRun);

it.effect("round-trips a minimal draft WeaveRun", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-1",
      projectId: "project-1",
      title: "Add a blog",
      vision: "# Goal\nShip a blog.",
      status: "draft",
      concurrencyCap: 1,
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.id, "run-1");
    assert.strictEqual(parsed.status, "draft");
    assert.strictEqual(parsed.concurrencyCap, 1);
    assert.strictEqual(parsed.currentBlueprintVersion, undefined);
    assert.strictEqual(parsed.currentPhaseId, undefined);
    assert.strictEqual(parsed.parentThreadId, undefined);
    assert.strictEqual(parsed.parentMessageId, undefined);
    assert.strictEqual(parsed.snapshotContent, undefined);
  }),
);

it.effect("round-trips a running WeaveRun with parent-thread metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-2",
      projectId: "project-1",
      title: "Add a blog",
      vision: "# Goal\nShip a blog.",
      parentThreadId: "thread-parent",
      parentMessageId: "msg-123",
      snapshotContent: "# Parent chat\n…",
      currentBlueprintVersion: 1,
      status: "running",
      currentPhaseId: "phase-1",
      concurrencyCap: 1,
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.status, "running");
    assert.strictEqual(parsed.currentBlueprintVersion, 1);
    assert.strictEqual(parsed.currentPhaseId, "phase-1");
    assert.strictEqual(parsed.parentThreadId, "thread-parent");
  }),
);

it.effect("rejects concurrencyCap outside 1..8", () =>
  Effect.gen(function* () {
    const tooSmall = yield* Effect.exit(
      decodeWeaveRun({
        id: "run-3",
        projectId: "project-1",
        title: "X",
        vision: "",
        status: "draft",
        concurrencyCap: 0,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(tooSmall._tag, "Failure");

    const tooBig = yield* Effect.exit(
      decodeWeaveRun({
        id: "run-4",
        projectId: "project-1",
        title: "X",
        vision: "",
        status: "draft",
        concurrencyCap: 9,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(tooBig._tag, "Failure");

    const nonInt = yield* Effect.exit(
      decodeWeaveRun({
        id: "run-5",
        projectId: "project-1",
        title: "X",
        vision: "",
        status: "draft",
        concurrencyCap: 1.5,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(nonInt._tag, "Failure");
  }),
);

it.effect("decodes a WeaveRun without planningDepthCap (field is optional)", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-1",
      projectId: "project-1",
      title: "Test run",
      vision: "do the thing",
      status: "draft",
      concurrencyCap: 1,
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.planningDepthCap, undefined);
  }),
);

it.effect("decodes a WeaveRun with planningDepthCap = 3", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRun({
      id: "run-2",
      projectId: "project-1",
      title: "Capped run",
      vision: "do the other thing",
      status: "draft",
      concurrencyCap: 1,
      planningDepthCap: 3,
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.planningDepthCap, 3);
  }),
);

const decodeWeaveCreate = Schema.decodeUnknownEffect(WeaveCreateCommand);
const decodeWeaveBlueprintApprove = Schema.decodeUnknownEffect(WeaveBlueprintApproveCommand);
const decodeWeavePhaseApprove = Schema.decodeUnknownEffect(WeavePhaseApproveCommand);
const decodeWeaveDecisionResolve = Schema.decodeUnknownEffect(WeaveDecisionResolveCommand);
const decodeWeaveExit = Schema.decodeUnknownEffect(WeaveExitCommand);
const decodeWeaveDispatchable = Schema.decodeUnknownEffect(WeaveDispatchableCommand);

it.effect("decodes weave.create with required fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveCreate({
      type: "weave.create",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "Add blog",
      vision: "# Goal",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.create");
    assert.strictEqual(parsed.weaveRunId, "run-1");
    assert.strictEqual(parsed.parentThreadId, undefined);
  }),
);

it.effect("decodes weave.blueprint.approve with concurrency cap", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintApprove({
      type: "weave.blueprint.approve",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      blueprintVersion: 1,
      concurrencyCap: 1,
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.blueprintVersion, 1);
    assert.strictEqual(parsed.concurrencyCap, 1);
  }),
);

it.effect("rejects weave.blueprint.approve with concurrencyCap out of range", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWeaveBlueprintApprove({
        type: "weave.blueprint.approve",
        commandId: "cmd-bad",
        weaveRunId: "run-1",
        blueprintVersion: 1,
        concurrencyCap: 9,
        createdAt: "2026-04-21T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes weave.phase.approve", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePhaseApprove({
      type: "weave.phase.approve",
      commandId: "cmd-3",
      weaveRunId: "run-1",
      phaseId: "phase-1",
      approval: "approved",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.approval, "approved");
  }),
);

it.effect("decodes weave.decision.resolve with rationale", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecisionResolve({
      type: "weave.decision.resolve",
      commandId: "cmd-4",
      weaveRunId: "run-1",
      decisionId: "decision-1",
      answer: "jotai",
      byUser: true,
      rationale: "Already in repo.",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.answer, "jotai");
    assert.strictEqual(parsed.byUser, true);
    assert.strictEqual(parsed.rationale, "Already in repo.");
  }),
);

it.effect("decodes weave.exit with reason", () =>
  Effect.gen(function* () {
    for (const reason of ["complete", "aborted"] as const) {
      const parsed = yield* decodeWeaveExit({
        type: "weave.exit",
        commandId: "cmd-5",
        weaveRunId: "run-1",
        reason,
        createdAt: "2026-04-21T00:00:00.000Z",
      });
      assert.strictEqual(parsed.reason, reason);
    }
  }),
);

it.effect("WeaveDispatchableCommand union decodes every variant", () =>
  Effect.gen(function* () {
    const create = yield* decodeWeaveDispatchable({
      type: "weave.create",
      commandId: "cmd-u1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "X",
      vision: "",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(create.type, "weave.create");

    const exit = yield* decodeWeaveDispatchable({
      type: "weave.exit",
      commandId: "cmd-u2",
      weaveRunId: "run-1",
      reason: "aborted",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(exit.type, "weave.exit");
  }),
);

import {
  WeaveBlueprintCompileCommand,
  WeaveInternalCommand,
  WeaveNodeDispatchCommand,
  WeaveNodeFailedCommand,
  WeaveNodeVerifiedCommand,
} from "./weave.ts";

const decodeWeaveBlueprintCompile = Schema.decodeUnknownEffect(WeaveBlueprintCompileCommand);
const decodeWeaveNodeDispatch = Schema.decodeUnknownEffect(WeaveNodeDispatchCommand);
const decodeWeaveNodeVerified = Schema.decodeUnknownEffect(WeaveNodeVerifiedCommand);
const decodeWeaveNodeFailed = Schema.decodeUnknownEffect(WeaveNodeFailedCommand);
const decodeWeaveInternal = Schema.decodeUnknownEffect(WeaveInternalCommand);

it.effect("decodes weave.blueprint.compile with reason", () =>
  Effect.gen(function* () {
    for (const reason of ["initial", "amendment", "redesign"] as const) {
      const parsed = yield* decodeWeaveBlueprintCompile({
        type: "weave.blueprint.compile",
        commandId: "cmd-c1",
        weaveRunId: "run-1",
        reason,
        createdAt: "2026-04-21T00:00:00.000Z",
      });
      assert.strictEqual(parsed.reason, reason);
    }
  }),
);

it.effect("decodes weave.node.dispatch", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeDispatch({
      type: "weave.node.dispatch",
      commandId: "cmd-d1",
      weaveRunId: "run-1",
      nodeId: "node-1",
      childThreadId: "thread-xyz",
      worktreePath: "/tmp/wt",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.childThreadId, "thread-xyz");
    assert.strictEqual(parsed.worktreePath, "/tmp/wt");
  }),
);

it.effect("decodes weave.node.verified", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeVerified({
      type: "weave.node.verified",
      commandId: "cmd-v1",
      weaveRunId: "run-1",
      nodeId: "node-1",
      verifierOutcome: "tests-passed",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.verifierOutcome, "tests-passed");
  }),
);

it.effect("decodes weave.node.failed with reason", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeFailed({
      type: "weave.node.failed",
      commandId: "cmd-f1",
      weaveRunId: "run-1",
      nodeId: "node-1",
      reason: "Verifier exited with code 1",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.reason, "Verifier exited with code 1");
  }),
);

it.effect("WeaveInternalCommand union decodes every variant", () =>
  Effect.gen(function* () {
    const compile = yield* decodeWeaveInternal({
      type: "weave.blueprint.compile",
      commandId: "cmd-u3",
      weaveRunId: "run-1",
      reason: "initial",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(compile.type, "weave.blueprint.compile");

    const failed = yield* decodeWeaveInternal({
      type: "weave.node.failed",
      commandId: "cmd-u4",
      weaveRunId: "run-1",
      nodeId: "node-1",
      reason: "x",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(failed.type, "weave.node.failed");
  }),
);

import { WeaveCommand } from "./weave.ts";

const decodeWeaveCommand = Schema.decodeUnknownEffect(WeaveCommand);

it.effect("WeaveCommand union decodes a dispatchable variant", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveCommand({
      type: "weave.create",
      commandId: "cmd-wc1",
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "X",
      vision: "",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.create");
  }),
);

it.effect("WeaveCommand union decodes an internal variant", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveCommand({
      type: "weave.node.verified",
      commandId: "cmd-wc2",
      weaveRunId: "run-1",
      nodeId: "node-1",
      verifierOutcome: "tests-passed",
      createdAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.node.verified");
  }),
);

import {
  WeaveBlueprintApprovedPayload,
  WeaveBlueprintCompiledPayload,
  WeaveCreatedPayload,
  WeaveDecisionResolvedPayload,
  WeaveExitedPayload,
  WeaveNodeDispatchedPayload,
  WeaveNodeFailedPayload,
  WeaveNodeVerifiedPayload,
  WeavePhaseApprovedPayload,
  WeavePlannerThreadCreatedPayload,
} from "./weave.ts";

const decodeWeaveCreatedPayload = Schema.decodeUnknownEffect(WeaveCreatedPayload);
const decodeWeaveBlueprintCompiledPayload = Schema.decodeUnknownEffect(
  WeaveBlueprintCompiledPayload,
);
const decodeWeaveBlueprintApprovedPayload = Schema.decodeUnknownEffect(
  WeaveBlueprintApprovedPayload,
);
const decodeWeaveNodeDispatchedPayload = Schema.decodeUnknownEffect(WeaveNodeDispatchedPayload);
const decodeWeaveNodeVerifiedPayload = Schema.decodeUnknownEffect(WeaveNodeVerifiedPayload);
const decodeWeaveNodeFailedPayload = Schema.decodeUnknownEffect(WeaveNodeFailedPayload);
const decodeWeaveDecisionResolvedPayload = Schema.decodeUnknownEffect(WeaveDecisionResolvedPayload);
const decodeWeavePhaseApprovedPayload = Schema.decodeUnknownEffect(WeavePhaseApprovedPayload);
const decodeWeaveExitedPayload = Schema.decodeUnknownEffect(WeaveExitedPayload);

it.effect("decodes WeaveCreatedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveCreatedPayload({
      weaveRunId: "run-1",
      projectId: "project-1",
      title: "X",
      vision: "",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.weaveRunId, "run-1");
  }),
);

it.effect("decodes WeaveBlueprintCompiledPayload with embedded Blueprint", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintCompiledPayload({
      weaveRunId: "run-1",
      version: 1,
      blueprint: {
        version: 1,
        nodes: [],
        phases: [],
        contracts: [],
        decisions: [],
        compiledAt: "2026-04-21T00:00:00.000Z",
        compiledBy: "planner",
      },
      compiledBy: "planner",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.compiledBy, "planner");
  }),
);

it.effect("decodes WeaveBlueprintApprovedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintApprovedPayload({
      weaveRunId: "run-1",
      version: 1,
      concurrencyCap: 1,
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.concurrencyCap, 1);
  }),
);

it.effect("decodes WeaveNodeDispatchedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeDispatchedPayload({
      weaveRunId: "run-1",
      nodeId: "node-1",
      childThreadId: "thread-1",
      worktreePath: "/tmp/wt",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.nodeId, "node-1");
  }),
);

it.effect("decodes WeaveNodeVerifiedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeVerifiedPayload({
      weaveRunId: "run-1",
      nodeId: "node-1",
      verifierOutcome: "tests-passed",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.verifierOutcome, "tests-passed");
  }),
);

it.effect("decodes WeaveNodeFailedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeFailedPayload({
      weaveRunId: "run-1",
      nodeId: "node-1",
      reason: "x",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.reason, "x");
  }),
);

it.effect("decodes WeaveDecisionResolvedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveDecisionResolvedPayload({
      weaveRunId: "run-1",
      decisionId: "decision-1",
      answer: "a",
      byUser: false,
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.byUser, false);
    assert.strictEqual(parsed.rationale, undefined);
  }),
);

it.effect("decodes WeavePhaseApprovedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePhaseApprovedPayload({
      weaveRunId: "run-1",
      phaseId: "phase-1",
      approval: "approved",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.approval, "approved");
  }),
);

it.effect("decodes WeaveExitedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveExitedPayload({
      weaveRunId: "run-1",
      reason: "complete",
      occurredAt: "2026-04-21T00:00:00.000Z",
    });
    assert.strictEqual(parsed.reason, "complete");
  }),
);

const decodeWeavePlannerThreadCreatedPayload = Schema.decodeUnknownEffect(
  WeavePlannerThreadCreatedPayload,
);

it.effect("round-trips WeavePlannerThreadCreatedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeavePlannerThreadCreatedPayload({
      weaveRunId: "run-1",
      threadId: "thread-planner-1",
      projectId: "project-1",
      title: "Planner thread",
      occurredAt: "2026-04-25T00:00:00.000Z",
    });
    assert.strictEqual(parsed.weaveRunId, "run-1");
    assert.strictEqual(parsed.threadId, "thread-planner-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Planner thread");
    assert.strictEqual(parsed.occurredAt, "2026-04-25T00:00:00.000Z");
  }),
);

it.effect("rejects WeavePlannerThreadCreatedPayload with missing threadId", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWeavePlannerThreadCreatedPayload({
        weaveRunId: "run-1",
        projectId: "project-1",
        title: "Planner thread",
        occurredAt: "2026-04-25T00:00:00.000Z",
        // threadId missing
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

import { WeaveBlueprintCompileReason } from "./weave.ts";

const decodeWeaveBlueprintCompileReason = Schema.decodeUnknownEffect(WeaveBlueprintCompileReason);

it.effect("accepts every WeaveBlueprintCompileReason literal", () =>
  Effect.gen(function* () {
    for (const r of ["initial", "amendment", "redesign", "phase-planning"] as const) {
      assert.strictEqual(yield* decodeWeaveBlueprintCompileReason(r), r);
    }
  }),
);

it.effect("rejects an unknown WeaveBlueprintCompileReason", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeWeaveBlueprintCompileReason("nope"));
    assert.strictEqual(result._tag, "Failure");
  }),
);

import { WeaveNodeMeta, WeaveRunProjectionSchema } from "./weave.ts";

const decodeWeaveNodeMeta = Schema.decodeUnknownEffect(WeaveNodeMeta);
const decodeWeaveRunProjection = Schema.decodeUnknownEffect(WeaveRunProjectionSchema);

it.effect("round-trips WeaveNodeMeta with status only", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeMeta({ status: "pending" });
    assert.strictEqual(parsed.status, "pending");
    assert.strictEqual(parsed.dispatchedAt, undefined);
    assert.strictEqual(parsed.verifiedAt, undefined);
    assert.strictEqual(parsed.failedAt, undefined);
    assert.strictEqual(parsed.failureReason, undefined);
  }),
);

it.effect("round-trips WeaveNodeMeta with status running + dispatchedAt", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeMeta({
      status: "running",
      dispatchedAt: "2026-04-25T10:00:00.000Z",
    });
    assert.strictEqual(parsed.status, "running");
    assert.strictEqual(parsed.dispatchedAt, "2026-04-25T10:00:00.000Z");
    assert.strictEqual(parsed.verifiedAt, undefined);
    assert.strictEqual(parsed.failedAt, undefined);
    assert.strictEqual(parsed.failureReason, undefined);
  }),
);

it.effect("round-trips WeaveNodeMeta with status failed + failedAt + failureReason", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeMeta({
      status: "failed",
      dispatchedAt: "2026-04-25T10:00:00.000Z",
      failedAt: "2026-04-25T10:30:00.000Z",
      failureReason: "Verifier exited with code 1",
    });
    assert.strictEqual(parsed.status, "failed");
    assert.strictEqual(parsed.dispatchedAt, "2026-04-25T10:00:00.000Z");
    assert.strictEqual(parsed.failedAt, "2026-04-25T10:30:00.000Z");
    assert.strictEqual(parsed.failureReason, "Verifier exited with code 1");
    assert.strictEqual(parsed.verifiedAt, undefined);
  }),
);

it.effect("round-trips WeaveNodeMeta with status verified + dispatchedAt + verifiedAt", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveNodeMeta({
      status: "verified",
      dispatchedAt: "2026-04-25T10:00:00.000Z",
      verifiedAt: "2026-04-25T11:00:00.000Z",
    });
    assert.strictEqual(parsed.status, "verified");
    assert.strictEqual(parsed.dispatchedAt, "2026-04-25T10:00:00.000Z");
    assert.strictEqual(parsed.verifiedAt, "2026-04-25T11:00:00.000Z");
    assert.strictEqual(parsed.failedAt, undefined);
    assert.strictEqual(parsed.failureReason, undefined);
  }),
);

it.effect("round-trips WeaveRunProjectionSchema with empty nodeMeta", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRunProjection({
      run: {
        id: "run-1",
        projectId: "project-1",
        title: "Add blog",
        vision: "# Goal",
        status: "running",
        concurrencyCap: 1,
        createdAt: "2026-04-25T00:00:00.000Z",
      },
      currentBlueprint: null,
      nodeMeta: new Map(),
      openDecisions: new Set(),
      autoDecisionLog: [],
      phaseApprovals: new Map(),
      childThreads: new Map(),
    });
    assert.strictEqual(parsed.run.id, "run-1");
    assert.strictEqual(parsed.nodeMeta.size, 0);
  }),
);

it.effect("round-trips WeaveRunProjectionSchema with populated nodeMeta entries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveRunProjection({
      run: {
        id: "run-2",
        projectId: "project-1",
        title: "Add blog",
        vision: "# Goal",
        status: "running",
        concurrencyCap: 2,
        createdAt: "2026-04-25T00:00:00.000Z",
      },
      currentBlueprint: null,
      nodeMeta: new Map([
        ["node-1", { status: "running", dispatchedAt: "2026-04-25T10:00:00.000Z" }],
        [
          "node-2",
          {
            status: "failed",
            dispatchedAt: "2026-04-25T09:00:00.000Z",
            failedAt: "2026-04-25T09:30:00.000Z",
            failureReason: "Contract amendment needed",
          },
        ],
      ]),
      openDecisions: new Set(),
      autoDecisionLog: [],
      phaseApprovals: new Map(),
      childThreads: new Map(),
    });
    assert.strictEqual(parsed.nodeMeta.size, 2);
    const node1 = parsed.nodeMeta.get("node-1" as Parameters<typeof parsed.nodeMeta.get>[0]);
    assert.strictEqual(node1?.status, "running");
    assert.strictEqual(node1?.dispatchedAt, "2026-04-25T10:00:00.000Z");
    const node2 = parsed.nodeMeta.get("node-2" as Parameters<typeof parsed.nodeMeta.get>[0]);
    assert.strictEqual(node2?.status, "failed");
    assert.strictEqual(node2?.failureReason, "Contract amendment needed");
  }),
);

import { WeaveBlueprintExtendedPayload } from "./weave.ts";

const decodeWeaveBlueprintExtendedPayload = Schema.decodeUnknownEffect(
  WeaveBlueprintExtendedPayload,
);

it.effect("round-trips a WeaveBlueprintExtendedPayload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintExtendedPayload({
      weaveRunId: "run-1",
      version: 2,
      plannerNodeId: "phase-1-planner",
      addedNodeIds: ["task-1", "task-2"],
      occurredAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.weaveRunId, "run-1");
    assert.strictEqual(parsed.version, 2);
    assert.strictEqual(parsed.plannerNodeId, "phase-1-planner");
    assert.deepStrictEqual(parsed.addedNodeIds, ["task-1", "task-2"]);
  }),
);

it.effect("rejects a WeaveBlueprintExtendedPayload missing plannerNodeId", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWeaveBlueprintExtendedPayload({
        weaveRunId: "run-1",
        version: 2,
        addedNodeIds: [],
        occurredAt: "2026-04-30T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

import { WeaveBlueprintExtendCommand } from "./weave.ts";

const decodeWeaveBlueprintExtendCommand = Schema.decodeUnknownEffect(WeaveBlueprintExtendCommand);

it.effect("round-trips a WeaveBlueprintExtendCommand", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveBlueprintExtendCommand({
      type: "weave.blueprint.extend",
      commandId: "cmd-1",
      weaveRunId: "run-1",
      plannerNodeId: "phase-1-planner",
      addedNodeIds: ["task-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.extend");
    assert.strictEqual(parsed.plannerNodeId, "phase-1-planner");
    assert.deepStrictEqual(parsed.addedNodeIds, ["task-1"]);
  }),
);

it.effect("WeaveInternalCommand union accepts weave.blueprint.extend", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWeaveInternal({
      type: "weave.blueprint.extend",
      commandId: "cmd-2",
      weaveRunId: "run-1",
      plannerNodeId: "phase-1-planner",
      addedNodeIds: [],
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "weave.blueprint.extend");
  }),
);
