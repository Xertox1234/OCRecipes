import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "relink-android-build-dirs.sh");

// Inherited git env (GIT_DIR etc.) overrides cwd-based git inside the script under
// test — strip it (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
const GIT_ENV_UNSET = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_COMMON_DIR: undefined,
  CI: undefined,
  EAS_BUILD: undefined,
} as const;

let root: string;
let main: string;
let wt: string;
let linkScript: string;
let callLog: string;

const git = (args: string[], cwd: string) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV_UNSET },
  }).trim();

function writeLinkScript(exitCode: number) {
  writeFileSync(
    linkScript,
    `#!/usr/bin/env bash\necho "$1" >> "${callLog}"\nexit ${exitCode}\n`,
  );
  chmodSync(linkScript, 0o755);
}

function run(cwd: string, env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV_UNSET,
      OCR_ANDROID_LINK_SCRIPT: linkScript,
      ...env,
    },
  });
}

const calls = () =>
  existsSync(callLog)
    ? readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean)
    : [];

beforeEach(() => {
  // realpathSync: macOS tmpdir() is a symlink; git reports physical paths.
  root = realpathSync(mkdtempSync(join(tmpdir(), "relink-android-")));
  main = join(root, "main");
  wt = join(root, "wt");
  linkScript = join(root, "link-lib-build-dirs.sh");
  callLog = join(root, "calls.log");
  mkdirSync(main);
  git(["init", "-q"], main);
  git(["config", "user.email", "t@example.com"], main);
  git(["config", "user.name", "t"], main);
  git(["commit", "-q", "--allow-empty", "-m", "init"], main);
  git(["worktree", "add", "-q", wt, "-b", "wt"], main);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("relink-android-build-dirs.sh", () => {
  it("runs the drive's link script with the main checkout's root", () => {
    writeLinkScript(0);
    const r = run(main);
    expect(r.status).toBe(0);
    expect(calls()).toEqual([main]);
  });

  it("does nothing when the link script is absent (drive not mounted, CI, EAS)", () => {
    const r = run(main);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
    expect(calls()).toEqual([]);
  });

  it("does nothing in a linked worktree — Android builds use the main checkout", () => {
    writeLinkScript(0);
    const r = run(wt);
    expect(r.status).toBe(0);
    expect(calls()).toEqual([]);
  });

  it.each([["CI"], ["EAS_BUILD"]])(
    "does nothing when %s is set, even if the script exists",
    (name) => {
      writeLinkScript(0);
      const r = run(main, { [name]: "true" });
      expect(r.status).toBe(0);
      expect(calls()).toEqual([]);
    },
  );

  it("never fails the install when the link script fails", () => {
    writeLinkScript(1);
    const r = run(main);
    expect(r.status).toBe(0);
    expect(calls()).toEqual([main]);
    expect(r.stderr).toMatch(/relink/i);
  });
});
