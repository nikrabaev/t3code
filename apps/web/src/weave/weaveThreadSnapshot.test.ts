import { describe, expect, it } from "vitest";

import { buildThreadMarkdownSnapshot, deriveTitleFromSnapshot } from "./weaveThreadSnapshot";

describe("buildThreadMarkdownSnapshot", () => {
  it("renders a two-message thread as markdown", () => {
    const messages = [
      { role: "user", text: "Build me a login page." },
      { role: "assistant", text: "Sure! Here is the plan." },
    ];
    const snapshot = buildThreadMarkdownSnapshot(messages);
    expect(snapshot).toBe(
      "## User\n\nBuild me a login page.\n\n## Assistant\n\nSure! Here is the plan.",
    );
  });

  it("skips system messages", () => {
    const messages = [
      { role: "system", text: "You are a helpful assistant." },
      { role: "user", text: "Hello." },
    ];
    const snapshot = buildThreadMarkdownSnapshot(messages);
    expect(snapshot).toBe("## User\n\nHello.");
  });

  it("skips messages with empty text", () => {
    const messages = [
      { role: "user", text: "" },
      { role: "assistant", text: "   " },
      { role: "user", text: "This is real content." },
    ];
    const snapshot = buildThreadMarkdownSnapshot(messages);
    expect(snapshot).toBe("## User\n\nThis is real content.");
  });

  it("returns empty string for an empty message list", () => {
    expect(buildThreadMarkdownSnapshot([])).toBe("");
  });
});

describe("deriveTitleFromSnapshot", () => {
  it("extracts the first non-heading line", () => {
    const snapshot = "## User\n\nBuild me a login page.\n\n## Assistant\n\nSure!";
    expect(deriveTitleFromSnapshot(snapshot)).toBe("Build me a login page.");
  });

  it("falls back to 'Weave run' for empty snapshot", () => {
    expect(deriveTitleFromSnapshot("")).toBe("Weave run");
  });

  it("truncates long first lines to 80 characters", () => {
    const longLine = "A".repeat(100);
    const snapshot = `## User\n\n${longLine}`;
    expect(deriveTitleFromSnapshot(snapshot)).toHaveLength(80);
  });
});
