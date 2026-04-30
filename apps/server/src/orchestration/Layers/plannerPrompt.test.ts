import { describe, expect, it } from "vitest";
import { buildPhasePlannerPrompt, buildPlannerPrompt } from "./plannerPrompt.ts";

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

  it("constrains kind to 'planning' (no other kinds)", () => {
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent: "" });
    expect(prompt).toContain('"kind": "planning"');
    expect(prompt).not.toContain('"kind": "raw"');
    expect(prompt).not.toContain('"raw" | "scaffold"');
  });

  it("requires exactly one Node per Phase", () => {
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent: "" });
    expect(prompt).toMatch(/exactly one (?:Planning )?Node per Phase/i);
  });

  it("requires contracts and decisions arrays to be empty for a meta-plan", () => {
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent: "" });
    expect(prompt).toMatch(/contracts.*\[\]/);
    expect(prompt).toMatch(/decisions.*\[\]/);
  });

  it("does not mention verifierCommand (Planning Nodes are schema-verified, not command-verified)", () => {
    const prompt = buildPlannerPrompt({ vision: "v", snapshotContent: "" });
    expect(prompt).not.toContain("verifierCommand");
    expect(prompt).not.toContain("bun run test");
    expect(prompt).not.toContain("npm test");
  });
});

describe("buildPhasePlannerPrompt", () => {
  const baseInput = {
    vision: "Build a TODO app",
    snapshotContent: "",
    phaseTitle: "Phase 1: Scaffolding",
    phaseDescription: "Stand up the Next.js app skeleton",
    plannerNodeDescription: "Plan the Next.js scaffold sub-tasks",
    plannerPhaseId: "phase-1",
  };

  it("instructs JSON-only output", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("Return a single JSON object");
    expect(prompt).toContain("JSON only, no prose");
  });

  it("constrains the output shape to PhasePlannerOutput", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain('"addedNodes"');
  });

  it("requires every added node to have phaseId equal to the planner's phase", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("phase-1");
    expect(prompt).toMatch(/phaseId.*must equal/i);
  });

  it("requires every added node to have status='pending'", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toMatch(/status.*"pending"/);
  });

  it("forbids kind='planning' (no recursion in Slice 3)", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toMatch(/kind.*MUST NOT.*planning/i);
  });

  it("includes the user vision and phase context", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("Build a TODO app");
    expect(prompt).toContain("Phase 1: Scaffolding");
    expect(prompt).toContain("Stand up the Next.js app skeleton");
    expect(prompt).toContain("Plan the Next.js scaffold sub-tasks");
  });

  it("renders an empty snapshot as '(empty)'", () => {
    const prompt = buildPhasePlannerPrompt(baseInput);
    expect(prompt).toContain("(empty)");
  });

  it("appends a previousError section when provided", () => {
    const prompt = buildPhasePlannerPrompt({ ...baseInput, previousError: "JSON parse failed" });
    expect(prompt).toContain("PREVIOUS ATTEMPT FAILED WITH:");
    expect(prompt).toContain("JSON parse failed");
  });
});
