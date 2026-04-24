/**
 * ProcessRunner - Abstraction for running a subprocess in a working directory.
 *
 * Separates the WeaveContractConformer from the concrete `child_process.spawn`
 * invocation so that tests can inject a stub that returns controlled exit codes
 * without touching the filesystem.
 *
 * @module ProcessRunner
 */
import { Context, Data } from "effect";
import type { Effect } from "effect";

export class ProcessRunnerError extends Data.TaggedError("ProcessRunnerError")<{
  readonly reason: string;
}> {}

export interface ProcessRunnerResult {
  /** Exit code from the process. -1 when the process was killed (timeout). */
  readonly exitCode: number;
  /** Captured stdout, truncated to 1 MB. */
  readonly stdout: string;
  /** Captured stderr, truncated to 1 MB. */
  readonly stderr: string;
  /** True when the process was killed because it exceeded `timeoutMs`. */
  readonly timedOut: boolean;
}

export interface ProcessRunnerShape {
  readonly run: (input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<ProcessRunnerResult, ProcessRunnerError>;
}

export class ProcessRunner extends Context.Service<ProcessRunner, ProcessRunnerShape>()(
  "t3/orchestration/Services/ProcessRunner",
) {}
