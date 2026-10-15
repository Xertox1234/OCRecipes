import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "oc-worktree.sh");

// Inherited git env overrides `git -C` inside the script under test — strip it
// (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
const GIT_ENV_UNSET = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_COMMON_DIR: undefined,
} as const;

let base: string;
let repo: string;
let wtDir: string;

const git = (args: string[], cwd = repo) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV_UNSET },
  });

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV_UNSET,
      // Never register a contract in the real session's registry.
      CLAUDE_CODE_SESSION_ID: undefined,
      OC_SKIP_NPM_CI: "1",
      // "/" is a mount point on macOS and Linux CI alike → predicate true.
      OC_DRIVE_ROOT: "/",
      OC_WORKTREES_DIR: wtDir,
      ...env,
    },
  });
}

beforeEach(() => {
  // realpathSync: macOS tmpdir() is a symlink to /private/var/...; git reports physical paths.
  base = realpathSync(mkdtempSync(join(tmpdir(), "oc-wt-")));
  repo = join(base, "repo");
  wtDir = join(base, "worktrees");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "core.hooksPath", "/dev/null"]);
  writeFileSync(join(repo, "a.txt"), "a");
  git(["add", "a.txt"]);
  git(["commit", "-qm", "init"]);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("oc-worktree.sh", () => {
  it("exits 2 with usage when no branch is given", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });

  it("refuses when the drive root is a plain directory, creating nothing", () => {
    const fake = join(base, "U34Bolt");
    mkdirSync(fake);
    const r = run(["feat-x", "main"], {
      OC_DRIVE_ROOT: fake,
      OC_WORKTREES_DIR: undefined,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not mounted/);
    expect(existsSync(join(fake, "OCRecipes"))).toBe(false);
  });

  it("refuses when the drive root does not exist", () => {
    const r = run(["feat-x", "main"], { OC_DRIVE_ROOT: join(base, "Nope") });
    expect(r.status).toBe(1);
    expect(existsSync(wtDir)).toBe(false);
  });

  it("creates a new branch from the base with no upstream", () => {
    const r = run(["feat-x", "main"]);
    expect(r.status).toBe(0);
    const dest = join(wtDir, "feat-x");
    expect(r.stdout.trim().split("\n").pop()).toBe(dest);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], dest).trim()).toBe(
      "feat-x",
    );
    const up = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
      cwd: dest,
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
    expect(up.status).not.toBe(0);
  });

  it("checks out an existing local branch", () => {
    git(["branch", "existing"]);
    const r = run(["existing"]);
    expect(r.status).toBe(0);
    expect(
      git(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        join(wtDir, "existing"),
      ).trim(),
    ).toBe("existing");
  });

  it("tracks a remote-only branch instead of forking from the base", () => {
    const remote = join(base, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote], {
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
    git(["remote", "add", "origin", remote]);
    git(["checkout", "-qb", "feat/remote-only"]);
    writeFileSync(join(repo, "b.txt"), "b");
    git(["add", "b.txt"]);
    git(["commit", "-qm", "remote work"]);
    git(["push", "-q", "origin", "feat/remote-only"]);
    const tip = git(["rev-parse", "HEAD"]).trim();
    git(["checkout", "-q", "main"]);
    git(["branch", "-D", "feat/remote-only"]);
    git(["fetch", "-q", "origin"]);

    const r = run(["feat/remote-only"]);
    expect(r.status).toBe(0);
    const dest = join(wtDir, "feat-remote-only");
    expect(git(["rev-parse", "HEAD"], dest).trim()).toBe(tip);
    expect(git(["rev-parse", "--abbrev-ref", "@{u}"], dest).trim()).toBe(
      "origin/feat/remote-only",
    );
  });

  it("slugs slashes and other unsafe characters into a flat folder name", () => {
    // git itself rejects spaces in branch names; "@" is legal in a ref but not in the slug set.
    const r = run(["feat/a@b", "main"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(wtDir, "feat-a-b"))).toBe(true);
  });

  it("refuses an existing destination without touching it", () => {
    mkdirSync(join(wtDir, "feat-x"), { recursive: true });
    writeFileSync(join(wtDir, "feat-x", "keep.txt"), "keep");
    const r = run(["feat-x", "main"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/already exists/);
    expect(existsSync(join(wtDir, "feat-x", "keep.txt"))).toBe(true);
  });

  it("outside a Claude session, skips the contract and still succeeds", () => {
    const r = run(["feat-y", "main"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no worktree contract declared/);
  });
});
