/**
 * ProcessRunnerLive - Default layer for ProcessRunner delegating to the shared
 * `runProcess` utility in `apps/server/src/processRunner.ts`.
 *
 * The underlying utility provides:
 *  - 8 MB buffer cap per stream (vs the old 1 MB)
 *  - `stdoutTruncated` / `stderrTruncated` flags
 *  - SIGTERM → 1 s grace → SIGKILL graceful shutdown
 *  - Byte-accurate UTF-8 slicing that never splits multibyte chars
 *  - `settled` guard preventing double-resolution on ENOENT
 *
 * This adapter translates between the `runProcess` API and `ProcessRunnerShape`.
 *
 * @module ProcessRunnerLive
 */
import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner.ts";
import {
  ProcessRunner,
  ProcessRunnerError,
  type ProcessRunnerShape,
} from "../Services/ProcessRunner.ts";

const makeProcessRunner = Effect.succeed({
  run: (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess(input.command, [...input.args], {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs,
          allowNonZeroExit: true,
          outputMode: "truncate",
        }).then((result) => ({
          exitCode: result.timedOut ? -1 : (result.code ?? -1),
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          stdoutTruncated: result.stdoutTruncated ?? false,
          stderrTruncated: result.stderrTruncated ?? false,
        })),
      catch: (error) =>
        new ProcessRunnerError({
          reason: error instanceof Error ? error.message : String(error),
        }),
    }),
} satisfies ProcessRunnerShape);

export const ProcessRunnerLive = Layer.effect(ProcessRunner, makeProcessRunner);
