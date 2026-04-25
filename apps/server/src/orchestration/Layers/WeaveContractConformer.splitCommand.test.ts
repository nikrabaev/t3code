/**
 * Unit tests for the verifier command splitter.
 *
 * The full resolution + dispatch flow is covered by WeaveContractConformer.test.ts.
 */
import { describe, expect, it } from "vitest";

import { splitVerifierCommand } from "./WeaveContractConformer.ts";

describe("splitVerifierCommand", () => {
  it("splits a single-word command into command + empty args", () => {
    expect(splitVerifierCommand("pytest")).toEqual({ command: "pytest", args: [] });
  });

  it("splits a multi-word command into command + args", () => {
    expect(splitVerifierCommand("npm test")).toEqual({ command: "npm", args: ["test"] });
    expect(splitVerifierCommand("bun run test")).toEqual({
      command: "bun",
      args: ["run", "test"],
    });
    expect(splitVerifierCommand("cargo test --workspace")).toEqual({
      command: "cargo",
      args: ["test", "--workspace"],
    });
  });

  it("collapses runs of whitespace", () => {
    expect(splitVerifierCommand("npm   test")).toEqual({ command: "npm", args: ["test"] });
    expect(splitVerifierCommand("  pytest  ")).toEqual({ command: "pytest", args: [] });
    expect(splitVerifierCommand("npm\trun\ttest")).toEqual({
      command: "npm",
      args: ["run", "test"],
    });
  });

  it("throws on empty / whitespace-only input", () => {
    expect(() => splitVerifierCommand("")).toThrow(/empty command/);
    expect(() => splitVerifierCommand("   ")).toThrow(/empty command/);
  });
});
