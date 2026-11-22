// A subagent pinned to a model other than the session's does not inherit the session's
// effort level ("On another model, that level doesn't apply. To pick a subagent's level,
// set `effort` in its definition." — code.claude.com/docs/en/model-config.md). So every
// agent with its own `model:` states its `effort:` explicitly instead of leaving it to an
// undocumented fallback.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const SONNET_MEDIUM = [
  "code-reviewer",
  "server-reviewer",
  "mobile-reviewer",
  "ai-reviewer",
  "todo-researcher",
];

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

const agents = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({
    name: f.slice(0, -3),
    fm: frontmatter(readFileSync(path.join(AGENTS_DIR, f), "utf8")),
  }));

describe("agent effort frontmatter", () => {
  it("every agent pinned to a non-inherit model declares an effort", () => {
    const missing = agents
      .filter(({ fm }) => fm.model && fm.model !== "inherit")
      .filter(({ fm }) => !EFFORT_LEVELS.includes(fm.effort ?? ""))
      .map(({ name }) => name);
    expect(missing, "agents with a model but no valid effort").toEqual([]);
  });

  it("Sonnet reviewers run at medium", () => {
    const byName = new Map(agents.map((a) => [a.name, a.fm]));
    const wrong = SONNET_MEDIUM.filter(
      (name) => byName.get(name)?.effort !== "medium",
    );
    expect(wrong, "agents not pinned to effort: medium").toEqual([]);
  });
});
