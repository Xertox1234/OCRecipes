import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(__dirname, "..", "check-claude-md-budget.js");

/**
 * The script derives its repo root from `__dirname/..`, so copy it into
 * `<tmp>/scripts/` and write fixtures under `<tmp>/` — the temp tree becomes the
 * repo root. Never write fixtures into the real checkout: a stray CLAUDE.md
 * would load into every session started below it.
 */
const tmpDirs: string[] = [];

function makeRepo(files: Record<string, string>): string {
  // realpath: macOS os.tmpdir() is /var/..., the script resolves /private/var/...
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "claude-md-budget-")),
  );
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-claude-md-budget.js"),
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function run(root: string, args: string[]) {
  const result = spawnSync(
    "node",
    [path.join(root, "scripts", "check-claude-md-budget.js"), ...args],
    { encoding: "utf8", cwd: root },
  );
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

describe("check-claude-md-budget.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is silent-OK for a CLAUDE.md under the budget", () => {
    const root = makeRepo({ "CLAUDE.md": "x".repeat(4000) });
    const r = run(root, ["CLAUDE.md"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("over the");
  });

  it("warns, but still exits 0, for a CLAUDE.md over the budget", () => {
    const root = makeRepo({ "CLAUDE.md": "x".repeat(10_500) });
    const r = run(root, ["CLAUDE.md"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("CLAUDE.md");
    expect(r.out).toContain("10500 B");
    expect(r.out).toContain("over the 10240 B budget");
  });

  it("does not count block HTML comments (they are stripped before Claude sees the file)", () => {
    const comment = `<!--\n${"why ".repeat(2000)}\n-->\n`;
    const root = makeRepo({ "CLAUDE.md": comment + "x".repeat(4000) });
    const r = run(root, ["CLAUDE.md"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("over the");
  });

  it("checks a nested CLAUDE.md too", () => {
    const root = makeRepo({ "server/CLAUDE.md": "y".repeat(11_000) });
    const r = run(root, ["server/CLAUDE.md"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("server/CLAUDE.md");
    expect(r.out).toContain("over the 10240 B budget");
  });

  it("ignores files that are not named CLAUDE.md", () => {
    const root = makeRepo({ "docs/notes.md": "z".repeat(20_000) });
    const r = run(root, ["docs/notes.md"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("over the");
  });
});
