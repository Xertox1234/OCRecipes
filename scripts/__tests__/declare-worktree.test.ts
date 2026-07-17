import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const SCRIPT = join(__dirname, "..", "declare-worktree.sh");
const SESSION = `test-declare-${process.pid}`;
const REG_DIR = `/tmp/claude-worktree-contracts-${SESSION}`;

function keyFor(absPath: string): string {
  // Mirrors the script: first 16 hex chars of `shasum` (SHA-1) of the path.
  return createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

// Inherited git env (GIT_DIR etc.) overrides `git -C` inside the script under
// test — strip it (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
const GIT_ENV_UNSET = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_COMMON_DIR: undefined,
} as const;

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV_UNSET,
      CLAUDE_CODE_SESSION_ID: SESSION,
      ...env,
    },
  });
}

let repo: string;
let worktree: string;

beforeEach(() => {
  // realpathSync: macOS tmpdir() is /var/folders/... (a symlink to /private/var/...);
  // git reports PHYSICAL paths, and the script compares them literally.
  repo = realpathSync(mkdtempSync(join(tmpdir(), "declare-wt-")));
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
  git(["init", "-q"]);
  git([
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "init",
  ]);
  worktree = join(repo, "wt-a");
  git(["worktree", "add", "-q", worktree]);
});

afterEach(() => {
  rmSync(REG_DIR, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("declare-worktree.sh", () => {
  it("declares a linked worktree: registry entry holds the path", () => {
    const r = run([worktree]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(REG_DIR, keyFor(worktree)), "utf8")).toBe(
      worktree,
    );
  });

  it("registry directory is private (0700 — /tmp is world-writable)", () => {
    run([worktree]);
    expect(statSync(REG_DIR).mode & 0o777).toBe(0o700);
  });

  it("is idempotent: declaring twice leaves one entry", () => {
    run([worktree]);
    run([worktree]);
    expect(readdirSync(REG_DIR)).toHaveLength(1);
  });

  it("coexists: declaring a second worktree adds a second entry", () => {
    const wtB = join(repo, "wt-b");
    execFileSync("git", ["worktree", "add", "-q", wtB], { cwd: repo });
    run([worktree]);
    run([wtB]);
    expect(readdirSync(REG_DIR).sort()).toEqual(
      [keyFor(worktree), keyFor(wtB)].sort(),
    );
  });

  it("--remove deletes only that entry", () => {
    const wtB = join(repo, "wt-b");
    execFileSync("git", ["worktree", "add", "-q", wtB], { cwd: repo });
    run([worktree]);
    run([wtB]);
    const r = run(["--remove", worktree]);
    expect(r.status).toBe(0);
    expect(readdirSync(REG_DIR)).toEqual([keyFor(wtB)]);
  });

  it("--clear removes the registry directory", () => {
    run([worktree]);
    const r = run(["--clear"]);
    expect(r.status).toBe(0);
    expect(existsSync(REG_DIR)).toBe(false);
  });

  it("refuses a relative path", () => {
    const r = run(["some/relative/path"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("absolute");
  });

  it("refuses the main checkout", () => {
    const r = run([repo]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("main checkout");
  });

  it("refuses a directory that is not a worktree root", () => {
    const r = run([join(worktree, "..")]); // resolves oddly — use a real subdir instead
    // Simpler concrete case: a subdirectory of the worktree.
    execFileSync("mkdir", ["-p", join(worktree, "sub")]);
    const r2 = run([join(worktree, "sub")]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("not a worktree root");
    expect(r.status).not.toBe(0);
  });

  it("errors when CLAUDE_CODE_SESSION_ID is unset", () => {
    const r = spawnSync("bash", [SCRIPT, worktree], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: "" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
  });
});
