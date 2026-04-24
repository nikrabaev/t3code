/**
 * Converts a thread's message history into a markdown transcript suitable
 * for feeding to the planner as the initial vision / context.
 *
 * Only user and assistant messages with non-empty text are included.
 * Skipped: system messages, messages with empty text, tool-call content,
 * and image attachments (attachments carry no plain text).
 *
 * The caller is responsible for passing only the messages that exist at
 * the point in time the snapshot is taken (i.e. before the /weave turn).
 */

export interface SnapshotMessage {
  readonly role: string;
  readonly text: string;
}

export function buildThreadMarkdownSnapshot(messages: ReadonlyArray<SnapshotMessage>): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      // skip system messages and any future roles
      continue;
    }
    const text = msg.text.trim();
    if (!text) {
      // skip empty or whitespace-only messages
      continue;
    }
    lines.push(`## ${msg.role === "user" ? "User" : "Assistant"}`, "", text, "");
  }
  return lines.join("\n").trim();
}

/**
 * Derive a short title from a markdown snapshot by taking the first line of
 * the first user message.  Falls back to "Weave run" if nothing is found.
 */
export function deriveTitleFromSnapshot(snapshot: string): string {
  for (const line of snapshot.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      // take up to 80 chars, strip trailing punctuation if any
      return trimmed.slice(0, 80);
    }
  }
  return "Weave run";
}
