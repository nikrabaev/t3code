import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("026_ProjectionThreadsKind", (it) => {
  it.effect("adds kind column with default 'chat' to projection_threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 25 });

      // Insert a row without specifying kind (relies on column default after migration)
      yield* runMigrations({ toMigrationInclusive: 26 });

      // Insert a row without specifying kind — should default to 'chat'
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title,
          model_selection_json,
          runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id,
          created_at, updated_at,
          archived_at, latest_user_message_at,
          pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, deleted_at
        ) VALUES (
          'thread-chat-1', 'project-1', 'Chat thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access', 'default',
          NULL, NULL, NULL,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
          NULL, NULL,
          0, 0,
          0, NULL
        )
      `;

      const chatRows = yield* sql<{ kind: string }>`
        SELECT kind FROM projection_threads WHERE thread_id = 'thread-chat-1'
      `;
      assert.strictEqual(chatRows[0]?.kind, "chat");

      // Insert a row explicitly with kind = 'planner'
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title,
          model_selection_json,
          runtime_mode, interaction_mode,
          kind,
          branch, worktree_path, latest_turn_id,
          created_at, updated_at,
          archived_at, latest_user_message_at,
          pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, deleted_at
        ) VALUES (
          'thread-planner-1', 'project-1', 'Planner thread',
          '{"provider":"claudeAgent","model":"claude-sonnet-4-6"}',
          'full-access', 'default',
          'planner',
          NULL, NULL, NULL,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
          NULL, NULL,
          0, 0,
          0, NULL
        )
      `;

      const plannerRows = yield* sql<{ kind: string }>`
        SELECT kind FROM projection_threads WHERE thread_id = 'thread-planner-1'
      `;
      assert.strictEqual(plannerRows[0]?.kind, "planner");
    }),
  );
});
