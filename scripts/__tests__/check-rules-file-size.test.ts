import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const realScript = path.resolve(__dirname, "..", "check-rules-file-size.js");

/**
 * The script derives its repo root from `__dirname/..` and only accepts paths
 * under `docs/rules/`. So we copy it into `<tmp>/scripts/` and write fixtures to
 * `<tmp>/docs/rules/` — the copy's own location makes the temp tree the repo
 * root, and the fixtures land in scope. Writing fixtures into the REAL
 * docs/rules/ would be injected by the pattern hook if a test ever crashed
 * before cleanup.
 */
const tmpDirs: string[] = [];

function makeRepo(files: Record<string, number>): string {
  // realpath: on macOS os.tmpdir() is /var/... but the script resolves its own
  // location to /private/var/..., so an unresolved path fails the docs/rules/
  // scope check and the file is silently skipped — a green run over 0 files.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "rules-size-")),
  );
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "rules"), { recursive: true });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-rules-file-size.js"),
  );
  for (const [name, bytes] of Object.entries(files)) {
    // Exact byte count: the guard reads statSync().size, so content is irrelevant.
    fs.writeFileSync(path.join(root, "docs", "rules", name), "x".repeat(bytes));
  }
  return root;
}

function run(root: string, args: string[] = []) {
  const result = spawnSync(
    "node",
    [path.join(root, "scripts", "check-rules-file-size.js"), ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

describe("check-rules-file-size.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes a file comfortably under both thresholds, with no advisory", () => {
    const root = makeRepo({ "small.md": 3000 });
    const { status, out } = run(root);
    expect(status).toBe(0);
    expect(out).not.toMatch(/approaching/i);
  });

  it("ADVISES between the warn threshold and the cap — and must still exit 0", () => {
    // The whole point of the advisory: a warning that fails the build is just a
    // second wall 800 B earlier, which is the failure mode this replaces.
    const root = makeRepo({ "warm.md": 6000 });
    const { status, out } = run(root);
    expect(status).toBe(0);
    expect(out).toMatch(/approaching/i);
    expect(out).toContain("warm.md");
  });

  it("names the remaining headroom in the advisory so the reader can act on it", () => {
    const root = makeRepo({ "warm.md": 6000 });
    const { out } = run(root);
    expect(out).toContain("500 B");
  });

  it("does not advise at exactly the warn threshold — only above it", () => {
    const root = makeRepo({ "edge.md": 5700 });
    const { status, out } = run(root);
    expect(status).toBe(0);
    expect(out).not.toMatch(/approaching/i);
  });

  it("still FAILS over the hard cap", () => {
    const root = makeRepo({ "big.md": 6501 });
    const { status, out } = run(root);
    expect(status).toBe(1);
    expect(out).toContain("big.md");
    expect(out).toMatch(/exceed/i);
  });

  it("passes at exactly the cap", () => {
    const root = makeRepo({ "exact.md": 6500 });
    expect(run(root).status).toBe(0);
  });

  it("an advisory on one file does not mask a hard failure on another", () => {
    const root = makeRepo({ "warm.md": 6000, "big.md": 7000 });
    const { status, out } = run(root);
    expect(status).toBe(1);
    expect(out).toMatch(/approaching/i);
    expect(out).toContain("big.md");
  });

  it("advises in lint-staged mode too (explicit file args, not just a full scan)", () => {
    const root = makeRepo({ "warm.md": 6000 });
    const target = path.join(root, "docs", "rules", "warm.md");
    const { status, out } = run(root, [target]);
    expect(status).toBe(0);
    expect(out).toMatch(/approaching/i);
  });
});
