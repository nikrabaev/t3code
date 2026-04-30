/**
 * buildPlannerPrompt — pure prompt builder for the Weave planner.
 *
 * Instructs the model to emit a single JSON object matching the Blueprint
 * schema. On retry (previousError truthy) the previous error is appended so
 * the model can self-correct.
 *
 * Blueprint schema (derived from packages/contracts/src/weave.ts):
 *
 *   version          : number   (integer, >= 0)
 *   compiledAt       : string   (ISO-8601 datetime)
 *   compiledBy       : "planner" | "amendment" | "redesign"
 *   phases           : WeavePhase[]
 *   nodes            : WeaveNode[]
 *   contracts        : WeaveContract[]
 *   decisions        : WeaveDecision[]
 *
 * @module plannerPrompt
 */

/**
 * Build the structured prompt the meta-planner sends to the LLM.
 *
 * Slice 2 of incremental planning: emits a meta-plan — a Blueprint with N
 * Phases, exactly one `kind: "planning"` Node per Phase, and zero Tasks.
 * Each Planning Node, when later dispatched (Slice 3+), will emit the rest
 * of its Phase's sub-DAG. The meta-planner does not author contracts or
 * decisions — those come from Phase Planners.
 */
export function buildPlannerPrompt(input: {
  vision: string;
  snapshotContent: string;
  previousError?: string;
}): string {
  const parts: string[] = [
    "You are the Weave meta-planner. Compile a meta-plan Blueprint from the user's vision.",
    "",
    "OUTPUT REQUIREMENTS:",
    "- Return a single JSON object. JSON only, no prose, no markdown fences, no commentary.",
    "- The output must be valid JSON parseable by JSON.parse().",
    "- Do not include any text before or after the JSON object.",
    "",
    "BLUEPRINT SCHEMA (all fields required unless marked optional):",
    "{",
    '  "version": 1,',
    '  "compiledAt": "<ISO-8601 datetime, e.g. 2026-01-01T00:00:00.000Z>",',
    '  "compiledBy": "planner",',
    '  "phases": [',
    "    {",
    '      "id": "<WeavePhaseId — non-empty string>",',
    '      "ordinal": 0,',
    '      "title": "<non-empty string>",',
    '      "description": "<string>",',
    '      "approval": "pending"',
    "    }",
    "  ],",
    '  "nodes": [',
    "    {",
    '      "id": "<WeaveNodeId — non-empty string>",',
    '      "title": "<non-empty string — names the Planning Node, e.g. \\"Plan Phase 1: Scaffolding\\">",',
    '      "description": "<string — what the Planning Node will plan>",',
    '      "kind": "planning",',
    '      "phaseId": "<must reference a phase id above; each phase has exactly one Planning Node>",',
    '      "scope": { "readSet": [], "writeSet": [] },',
    '      "inputContractIds": [],',
    '      "outputContractIds": [],',
    '      "verifierDescription": "<string — describe the schema/contract this Planning Node\'s emission will satisfy>",',
    '      "dependsOn": [],',
    '      "status": "pending"',
    "    }",
    "  ],",
    '  "contracts": [],',
    '  "decisions": []',
    "}",
    "",
    "RULES:",
    "- Emit exactly one Planning Node per Phase. The total nodes count MUST equal the phases count.",
    '- Every Node MUST have `"kind": "planning"`. No other kinds are allowed in a meta-plan.',
    "- phases[].ordinal must be unique integers starting at 0.",
    "- Each Node's `phaseId` must match exactly one phase, and no two Nodes may share a phaseId.",
    "- Node `scope`, `inputContractIds`, `outputContractIds`, and `dependsOn` MUST all be empty for Planning Nodes — the per-Node sub-DAG is emitted later by the Planning Node itself, not by the meta-planner.",
    '- `contracts` and `decisions` MUST both be empty arrays (`[]`). Authoring contracts and decisions is the responsibility of Phase Planners, not the meta-planner.',
    "- At least one phase and one Planning Node are required.",
    "",
    "USER VISION:",
    input.vision,
    "",
    "CODEBASE SNAPSHOT:",
    input.snapshotContent || "(empty)",
  ];

  if (input.previousError) {
    parts.push(
      "",
      "PREVIOUS ATTEMPT FAILED WITH:",
      input.previousError,
      "",
      "Fix the issue described above and emit valid JSON.",
    );
  }

  return parts.join("\n");
}
