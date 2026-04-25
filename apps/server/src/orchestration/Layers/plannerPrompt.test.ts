import { describe, expect, it } from "vitest";
import { buildPlannerPrompt } from "./plannerPrompt.ts";

describe("buildPlannerPrompt", () => {
  it("without previousError does NOT contain the PREVIOUS ATTEMPT FAILED section", () => {
    const prompt = buildPlannerPrompt({
      vision: "Build a todo app",
      snapshotContent: "src/index.ts exists",
    });
    expect(prompt).not.toContain("PREVIOUS ATTEMPT FAILED");
  });

  it("with previousError DOES contain the error string", () => {
    const prompt = buildPlannerPrompt({
      vision: "Build a todo app",
      snapshotContent: "",
      previousError: "syntax error at line 3",
    });
    expect(prompt).toContain("PREVIOUS ATTEMPT FAILED");
    expect(prompt).toContain("syntax error at line 3");
  });

  it("always contains JSON-only instruction", () => {
    const prompt = buildPlannerPrompt({
      vision: "Build something",
      snapshotContent: "",
    });
    expect(prompt).toContain("JSON only");
  });

  it("includes the vision string", () => {
    const vision = "A unique vision string for testing purposes";
    const prompt = buildPlannerPrompt({ vision, snapshotContent: "" });
    expect(prompt).toContain(vision);
  });

  it("includes the snapshotContent when provided", () => {
    const snapshotContent = "apps/server/src/index.ts\npackages/contracts/src/index.ts";
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent });
    expect(prompt).toContain(snapshotContent);
  });

  it("shows (empty) when snapshotContent is empty string", () => {
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent: "" });
    expect(prompt).toContain("(empty)");
  });

  it("without projectVerifierCommand, prompts the planner to infer the test runner", () => {
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent: "" });
    expect(prompt).toContain('"verifierCommand"');
    expect(prompt).toContain("falls back to `bun run test`");
    expect(prompt).toContain("package.json scripts");
  });

  it("with projectVerifierCommand, names the project default and asks for overrides only", () => {
    const prompt = buildPlannerPrompt({
      vision: "v",
      snapshotContent: "",
      projectVerifierCommand: "cargo test",
    });
    expect(prompt).toContain('"verifierCommand"');
    expect(prompt).toContain("`cargo test`");
    expect(prompt).toContain("ONLY when this node should be verified with a different command");
    expect(prompt).not.toContain("falls back to `bun run test`");
  });
});
