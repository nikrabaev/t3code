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
 *
 * @param input.projectVerifierCommand - Project-level Weave verifier default
 *   (e.g. `"npm test"`, `"cargo test"`). When provided, the planner is told
 *   this is the default and is invited to emit per-node `verifierCommand`
 *   only for nodes whose verification is *not* the project default. When
 *   absent, the planner is asked to infer an appropriate command from the
 *   codebase snapshot.
 */
export function buildPlannerPrompt(input: {
  vision: string;
  snapshotContent: string;
  projectVerifierCommand?: string;
  previousError?: string;
}): string {
  const projectVerifierCommand = input.projectVerifierCommand?.trim();
  const verifierCommandSchemaLine = projectVerifierCommand
    ? `      "verifierCommand": "<optional — omit unless this node needs a different command than the project default '${projectVerifierCommand}'>",`
    : '      "verifierCommand": "<optional — non-empty shell command, omit to use the runtime default>",';
  const verifierGuidanceRule = projectVerifierCommand
    ? `- The project-level Weave verifier command is \`${projectVerifierCommand}\`. Emit \`verifierCommand\` per node ONLY when this node should be verified with a different command (e.g. a docs node verified with \`mkdocs build\`, a contract node with a typecheck-only command). Omit the field for nodes that use the project default.`
    : "- The runtime falls back to `bun run test` if no `verifierCommand` is set. If the project uses a different test runner (e.g. `npm test`, `cargo test`, `pytest`), emit `verifierCommand` per node accordingly. Detect the project type from the codebase snapshot (package.json scripts, Cargo.toml, pyproject.toml, etc.).";

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
    verifierCommandSchemaLine,
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
    verifierGuidanceRule,
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
