import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ServerSettings } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);

it.effect("ServerSettings decodes {} and provides weave.planner defaults", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeServerSettings({});
    assert.strictEqual(decoded.weave.planner.provider, "claudeAgent");
    assert.strictEqual(decoded.weave.planner.modelSelection.provider, "claudeAgent");
    assert.strictEqual(decoded.weave.planner.modelSelection.model, "claude-sonnet-4-6");
  }),
);

it.effect("ServerSettings round-trips an override of weave.planner.provider", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeServerSettings({
      weave: {
        planner: {
          provider: "codex",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
        },
      },
    });
    assert.strictEqual(decoded.weave.planner.provider, "codex");
    assert.strictEqual(decoded.weave.planner.modelSelection.provider, "codex");
    assert.strictEqual(decoded.weave.planner.modelSelection.model, "gpt-5.4");
  }),
);
