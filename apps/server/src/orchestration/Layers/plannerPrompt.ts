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
 * Build the structured prompt the planner sends to the LLM.
 */
export function buildPlannerPrompt(input: {
  vision: string;
  snapshotContent: string;
  previousError?: string;
}): string {
  const parts: string[] = [
    "You are the Weave planner. Compile a Blueprint from the user's vision.",
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
    '      "title": "<non-empty string>",',
    '      "description": "<string>",',
    '      "kind": "raw" | "scaffold" | "contract" | "utility",',
    '      "phaseId": "<must reference a phase id above>",',
    '      "scope": { "readSet": [], "writeSet": [] },',
    '      "inputContractIds": [],',
    '      "outputContractIds": [],',
    '      "verifierDescription": "<string>",',
    '      "dependsOn": [],',
    '      "status": "pending"',
    "    }",
    "  ],",
    '  "contracts": [',
    "    {",
    '      "id": "<WeaveContractId — non-empty string>",',
    '      "ownerNodeId": "<must reference one of the node ids above>",',
    '      "surface": "<string — Markdown-with-types describing the API surface; may be empty>",',
    '      "semantics": "<string — Markdown describing behaviour; may be empty>"',
    "      // conformanceTestPath is OPTIONAL — omit unless you have a concrete path",
    "    }",
    "  ],",
    '  "decisions": [',
    "    {",
    '      "id": "<WeaveDecisionId — non-empty string>",',
    '      "question": "<non-empty string>",',
    '      "options": ["<string>", "<string>"],',
    '      "blastRadiusNodeIds": ["<node id this decision affects>"]',
    "      // preAuthScope and resolution are OPTIONAL — omit for v0.1",
    "    }",
    "  ]",
    "}",
    "",
    "RULES:",
    "- phases[].ordinal must be unique integers starting at 0.",
    "- nodes[].phaseId must match one of the phases[].id values.",
    "- nodes[].dependsOn must only reference node ids defined in the same nodes array.",
    "- contracts[].ownerNodeId must reference a node id in the nodes array.",
    "- decisions[].blastRadiusNodeIds must only reference node ids in the nodes array.",
    '- contracts and decisions arrays MAY BE EMPTY ([]). For a simple Blueprint, emit `"contracts": []` and `"decisions": []` rather than inventing entries.',
    "- If you DO emit a contract entry, every required field above must be present (no omissions).",
    "- At least one phase and one node are required.",
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
