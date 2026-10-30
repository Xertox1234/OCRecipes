import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(
  __dirname,
  "..",
  "check-skill-positional-params.js",
);

/**
 * Same layout trick as check-rules-file-size.test.ts: the script derives its
 * repo root from `__dirname/..`, so a copy in `<tmp>/scripts/` makes the temp
 * tree the repo root and fixtures under `<tmp>/.claude/skills/` land in scope.
 */
const tmpDirs: string[] = [];

function makeRepo(skills: Record<string, string>): string {
  // realpath: macOS os.tmpdir() is /var/... but the script resolves itself to
  // /private/var/..., which would fail the scope check — a green run over 0 files.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "skill-params-")),
  );
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-skill-positional-params.js"),
  );
  for (const [rel, body] of Object.entries(skills)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return root;
}

function run(scriptPath: string, args: string[] = []) {
  const result = spawnSync("node", [scriptPath, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

const script = (root: string) =>
  path.join(root, "scripts", "check-skill-positional-params.js");

describe("check-skill-positional-params.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on a shell positional parameter and names file and line", () => {
    const root = makeRepo({
      ".claude/skills/demo/SKILL.md": 'intro\n```bash\nf() { w="$1"; }\n```\n',
    });
    const r = run(script(root));
    expect(r.status).toBe(1);
    expect(r.out).toContain(".claude/skills/demo/SKILL.md:3");
    expect(r.out).toContain("$1");
  });

  it("fails on awk $0, which the loader also substitutes", () => {
    const root = makeRepo({
      ".claude/skills/demo/SKILL.md": "awk '{ print substr($0, 2) }'\n",
    });
    expect(run(script(root)).status).toBe(1);
  });

  it("passes $ARGUMENTS, named variables and a spaced '$ 5'", () => {
    const root = makeRepo({
      ".claude/skills/demo/SKILL.md": [
        "Args: $ARGUMENTS",
        'w="$WT_PATH"',
        "costs $ 5 or USD 10",
        "",
      ].join("\n"),
    });
    const r = run(script(root));
    expect(r.out).toContain("1 file(s)");
    expect(r.status).toBe(0);
  });

  it("ignores files outside .claude/skills/**/SKILL.md", () => {
    const root = makeRepo({
      ".claude/skills/demo/reference.md": 'w="$1"\n',
      "docs/notes.md": 'w="$1"\n',
    });
    const r = run(script(root), [
      path.join(root, ".claude/skills/demo/reference.md"),
      path.join(root, "docs/notes.md"),
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("0 file(s)");
  });

  it("checks only the files named on the command line (lint-staged mode)", () => {
    const root = makeRepo({
      ".claude/skills/bad/SKILL.md": 'w="$1"\n',
      ".claude/skills/good/SKILL.md": "fine\n",
    });
    const r = run(script(root), [
      path.join(root, ".claude/skills/good/SKILL.md"),
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("1 file(s)");
  });

  it("the repo's real skills are clean", () => {
    const r = run(realScript);
    expect(r.out).not.toContain("0 file(s)");
    expect(r.status).toBe(0);
  });
});
