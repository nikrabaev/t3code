/**
 * ProcessRunnerLive - Default layer for ProcessRunner using node:child_process.spawn.
 *
 * Collects stdout and stderr up to 1 MB each. Kills the child process with
 * SIGKILL when `timeoutMs` elapses and reports `timedOut: true`.
 *
 * @module ProcessRunnerLive
 */
import { spawn } from "node:child_process";
import { Effect, Layer } from "effect";

import {
  ProcessRunner,
  ProcessRunnerError,
  type ProcessRunnerShape,
  type ProcessRunnerResult,
} from "../Services/ProcessRunner.ts";

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB per stream

const makeProcessRunner = Effect.succeed({
  run: (input) =>
    Effect.callback<ProcessRunnerResult, ProcessRunnerError>((resume) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, input.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        const remaining = MAX_OUTPUT_BYTES - stdout.length;
        if (remaining > 0) {
          stdout += chunk.toString("utf8", 0, Math.min(chunk.length, remaining));
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const remaining = MAX_OUTPUT_BYTES - stderr.length;
        if (remaining > 0) {
          stderr += chunk.toString("utf8", 0, Math.min(chunk.length, remaining));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resume(Effect.fail(new ProcessRunnerError({ reason: `spawn failed: ${err.message}` })));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resume(
          Effect.succeed({
            exitCode: timedOut ? -1 : (code ?? -1),
            stdout,
            stderr,
            timedOut,
          }),
        );
      });
    }),
} satisfies ProcessRunnerShape);

export const ProcessRunnerLive = Layer.effect(ProcessRunner, makeProcessRunner);
