import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "install-git-hooks.sh");

// Inherited git env (GIT_DIR etc.) overrides cwd-based git inside the script under
// test — strip it (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
const GIT_ENV_UNSET = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_COMMON_DIR: undefined,
  HUSKY: undefined,
} as const;

let root: string;
let main: string;
let wt: string;
let stubBin: string;

const git = (args: string[], cwd: string) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV_UNSET },
  }).trim();

const hooksPath = (cwd: string) =>
  spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV_UNSET },
  }).stdout.trim();

function run(cwd: string, env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV_UNSET,
      PATH: `${stubBin}:${process.env.PATH}`,
      ...env,
    },
  });
}

beforeEach(() => {
  // realpathSync: macOS tmpdir() is a symlink; git reports physical paths.
  root = realpathSync(mkdtempSync(join(tmpdir(), "install-git-hooks-")));
  main = join(root, "main");
  wt = join(root, "wt");
  stubBin = join(root, "bin");
  mkdirSync(main);
  mkdirSync(stubBin);
  git(["init", "-q"], main);
  git(["config", "user.email", "t@example.com"], main);
  git(["config", "user.name", "t"], main);
  git(["commit", "-q", "--allow-empty", "-m", "init"], main);
  git(["worktree", "add", "-q", wt, "-b", "wt"], main);
  // Stand-in for husky 9's install: it writes the RELATIVE `.husky/_` into the
  // shared config and generates the (gitignored) shims in the cwd's tree.
  writeFileSync(
    join(stubBin, "husky"),
    [
      "#!/bin/sh",
      "git config core.hooksPath .husky/_ || exit 1",
      "mkdir -p .husky/_",
      "printf '#!/bin/sh\\necho ran > \"$(git rev-parse --show-toplevel)/hook-ran\"\\n' > .husky/_/pre-commit",
      "cp .husky/_/pre-commit .husky/_/pre-push",
      "chmod +x .husky/_/pre-commit .husky/_/pre-push",
      "",
    ].join("\n"),
  );
  chmodSync(join(stubBin, "husky"), 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("install-git-hooks.sh", () => {
  it("points core.hooksPath at the main checkout's shims as an ABSOLUTE path", () => {
    const r = run(main);
    expect(r.status, r.stderr).toBe(0);
    expect(hooksPath(main)).toBe(join(main, ".husky/_"));
  });

  it("makes a commit in a linked worktree run the hook (relative path silently skipped it)", () => {
    // Control: husky's own relative value really does skip hooks in the worktree.
    execFileSync("sh", [join(stubBin, "husky")], {
      cwd: main,
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
    git(["commit", "-q", "--allow-empty", "-m", "before"], wt);
    expect(existsSync(join(wt, "hook-ran"))).toBe(false);

    expect(run(main).status).toBe(0);
    git(["commit", "-q", "--allow-empty", "-m", "after"], wt);
    expect(existsSync(join(wt, "hook-ran"))).toBe(true);
  });

  it("run from inside a worktree, still points at the MAIN checkout's shims", () => {
    expect(run(main).status).toBe(0);
    const r = run(wt);
    expect(r.status, r.stderr).toBe(0);
    expect(hooksPath(main)).toBe(join(main, ".husky/_"));
  });

  it("leaves husky's value alone when the main checkout has no shims", () => {
    // Install only in the worktree: main has no .husky/_, so an absolute path to it
    // would point at nothing and turn hooks off everywhere.
    const r = run(wt);
    expect(r.status, r.stderr).toBe(0);
    expect(hooksPath(main)).toBe(".husky/_");
  });

  it("HUSKY=0 skips the install entirely", () => {
    const r = run(main, { HUSKY: "0" });
    expect(r.status, r.stderr).toBe(0);
    expect(hooksPath(main)).toBe("");
  });

  it("outside a git repo, exits 0 after husky without touching anything", () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    writeFileSync(join(stubBin, "husky"), "#!/bin/sh\nexit 0\n");
    const r = run(plain);
    expect(r.status, r.stderr).toBe(0);
  });
});
