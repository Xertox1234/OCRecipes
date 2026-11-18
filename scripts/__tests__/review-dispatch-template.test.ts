// The real docs/AI_WORKFLOW.md dispatch template, as the review-dispatch mod reads it.
// The mod's own test (.claude/mods/review-dispatch/review-dispatch.test.ts) runs under
// `claude plugin test` against a stand-in template and is not part of CI; this file pins
// the live template under Vitest.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// The mod runs for real here, but it is imported through a non-literal path on purpose:
// tsc's `**/*.ts` include skips dot-directories, so `.claude/mods/**` is outside the
// project's type check (mods are typed by the Claude Code engine's own declarations). A
// static import would pull register.ts into `tsc --noEmit`, where `claude-code` does not
// resolve.
const MOD = path.join(ROOT, ".claude/mods/review-dispatch/hooks/register.ts");
const { extractTemplate, FILLED } = (await import(MOD)) as {
  extractTemplate: (doc: string) => string;
  FILLED: readonly string[];
};

const template = extractTemplate(
  readFileSync(path.join(ROOT, "docs/AI_WORKFLOW.md"), "utf8"),
);

// Placeholders the reviewer fills itself. Any other <…> must be one the mod fills:
// a new unfilled one stays literal in every expansion, and a hand-written prompt
// that fills it is refused for missing that fixed piece.
const REVIEWER_FILLED = [
  "<path>",
  "<your scratchpad directory>",
  "<reviewer>",
  "<HEAD>",
  "<scratchpad>",
];

describe("dispatch template (docs/AI_WORKFLOW.md)", () => {
  it("uses only placeholders the mod or the reviewer fills", () => {
    const used = [...new Set(template.match(/<[^<>\n]{1,60}>/g) ?? [])];
    const unknown = used.filter(
      (p) => !FILLED.includes(p) && !REVIEWER_FILLED.includes(p),
    );
    expect(unknown).toEqual([]);
  });

  it("has the reviewer load the binding rules for the changed files", () => {
    expect(template).toContain(
      'npx tsx "<WORKTREE>/scripts/lib/path-domains.ts" --typescript-crosscut <those files>',
    );
    expect(template).toContain("<WORKTREE>/docs/rules/NAME.md");
  });

  it("the rules command, filled in, prints the domains of the files", () => {
    const m =
      /`(npx tsx "<WORKTREE>\/scripts\/lib\/path-domains\.ts"[^`]*)`/.exec(
        template,
      );
    expect(m).not.toBeNull();
    const cmd = m![1]
      .split("<WORKTREE>")
      .join(ROOT)
      .split("<those files>")
      .join("server/routes/auth.ts docs/AI_WORKFLOW.md");
    const argv = cmd.split(" ").map((a) => a.replace(/^"|"$/g, ""));
    const out = execFileSync(argv[0], argv.slice(1), {
      cwd: ROOT,
      encoding: "utf8",
    });
    // control: a docs-only input prints nothing, so the step is skipped
    const none = execFileSync(
      "npx",
      [
        "tsx",
        path.join(ROOT, "scripts/lib/path-domains.ts"),
        "--typescript-crosscut",
        "docs/AI_WORKFLOW.md",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(out.split(", ")).toEqual(
      expect.arrayContaining(["api", "security", "typescript"]),
    );
    expect(none.trim()).toBe("");
  });
});
