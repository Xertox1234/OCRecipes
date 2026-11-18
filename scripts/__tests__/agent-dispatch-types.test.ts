// Project agents are dispatched under their own type, never as `general-purpose` told to
// follow the agent's file. A typed dispatch is what makes the file's frontmatter (model,
// disallowedTools) apply and lets hooks tell the agent apart by `agent_type`; the
// "read .claude/agents/X.md" form passes the instructions without either.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");
const BUILT_IN = new Set(["general-purpose", "Explore", "Plan"]);

function mdFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return mdFiles(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

const projectAgents = new Set(
  readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3)),
);
const sources = [
  ...mdFiles(path.join(ROOT, ".claude/skills")),
  ...mdFiles(AGENTS_DIR),
].map((file) => ({
  rel: path.relative(ROOT, file),
  text: readFileSync(file, "utf8"),
}));

// Every Agent({...}) block written in a skill or agent file.
const dispatches = sources.flatMap(({ rel, text }) =>
  [...text.matchAll(/Agent\(\{[\s\S]*?\n\s*\}\)/g)].map((m) => ({
    rel,
    block: m[0],
    type: /subagent_type:\s*"([^"]+)"/.exec(m[0])?.[1],
  })),
);

function frontmatter(agent: string): string {
  const text = readFileSync(path.join(AGENTS_DIR, `${agent}.md`), "utf8");
  return /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
}

describe("agent dispatch types", () => {
  it("finds the dispatch blocks it checks", () => {
    // control: the scan must see the known dispatch sites (todo SKILL's executor, the
    // executor's researcher, audit SKILL's doc researcher), or every check below is vacuous
    expect(dispatches.length).toBeGreaterThanOrEqual(3);
  });

  it("never sends general-purpose to follow a project agent's file", () => {
    const offenders = dispatches
      .filter((d) => d.type === "general-purpose")
      .filter((d) =>
        [...d.block.matchAll(/\.claude\/agents\/([a-z-]+)\.md/g)].some((m) =>
          projectAgents.has(m[1]),
        ),
      )
      .map((d) => `${d.rel}: ${d.block.split("\n")[1]?.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("names only built-in or existing project agent types", () => {
    const unknown = dispatches
      .filter((d) => d.type && !d.type.startsWith("<"))
      .filter((d) => !BUILT_IN.has(d.type!) && !projectAgents.has(d.type!))
      .map((d) => `${d.rel}: ${d.type}`);
    expect(unknown).toEqual([]);
  });

  it("dispatches the todo executor, todo researcher and audit doc researcher by type", () => {
    const types = (rel: string) =>
      dispatches.filter((d) => d.rel === rel).map((d) => d.type);
    expect(types(".claude/skills/todo/SKILL.md")).toContain("todo-executor");
    expect(types(".claude/agents/todo-executor.md")).toContain(
      "todo-researcher",
    );
    expect(types(".claude/skills/audit/SKILL.md")).toContain("docs-researcher");
  });

  it("researchers cannot edit files", () => {
    for (const agent of ["todo-researcher", "docs-researcher"]) {
      const disallowed =
        /^disallowedTools:\s*(.+)$/m.exec(frontmatter(agent))?.[1] ?? "";
      expect(disallowed.split(/,\s*/)).toEqual(
        expect.arrayContaining(["Edit", "Write", "NotebookEdit"]),
      );
    }
  });
});
