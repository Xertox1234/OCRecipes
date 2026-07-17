import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "verify-branch-merged.sh");

// Inherited git env (GIT_DIR etc.) overrides `git -C`/cwd inside the script under
// test — strip it (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
const GIT_ENV_UNSET = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_COMMON_DIR: undefined,
} as const;

// Fake `gh` controlled by env: FAKE_GH_STATE / FAKE_GH_OID (JSON fields),
// FAKE_GH_EXIT (exit code). Mirrors `gh pr view --json state,headRefOid`.
const FAKE_GH = `#!/usr/bin/env bash
if [ "\${FAKE_GH_EXIT:-0}" != "0" ]; then
  echo "\${FAKE_GH_STDERR:-no pull requests found for branch}" >&2
  exit "$FAKE_GH_EXIT"
fi
printf '{"state":"%s","headRefOid":"%s"}\\n' "$FAKE_GH_STATE" "\${FAKE_GH_OID:-}"
exit 0
`;

let tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

// cwd defaults to a fresh NON-repo dir so `git rev-parse` finds no refs — the
// pure PR-state paths must not depend on the caller's repo state.
function run(branch: string[], env: Record<string, string>, cwd?: string) {
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
  return spawnSync("bash", [SCRIPT, ...branch], {
    encoding: "utf8",
    cwd: cwd ?? dir,
    env: {
      ...process.env,
      ...GIT_ENV_UNSET,
      PATH: `${dir}:${process.env.PATH}`,
      ...env,
    },
  });
}

// Temp repo with branch todo/foo — for the headRefOid containment checks.
function makeRepo(): { dir: string; oid: string } {
  const dir = mkdtempSync(join(tmpdir(), "vbm-repo-"));
  tempDirs.push(dir);
  const g = (...args: string[]) =>
    spawnSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
  g("init", "-q", "-b", "main");
  g(
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "init",
  );
  g("branch", "todo/foo");
  const oid = g("rev-parse", "refs/heads/todo/foo").stdout.trim();
  return { dir, oid };
}

describe("verify-branch-merged.sh", () => {
  it("exit 0 when the fresh PR state is MERGED (no local refs to cross-check)", () => {
    const r = run(["todo/foo"], {
      FAKE_GH_STATE: "MERGED",
      FAKE_GH_OID: "abc123",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MERGED");
  });

  it("exit 0 when MERGED and the local branch tip equals the PR head", () => {
    const { dir, oid } = makeRepo();
    const r = run(
      ["todo/foo"],
      { FAKE_GH_STATE: "MERGED", FAKE_GH_OID: oid },
      dir,
    );
    expect(r.status).toBe(0);
  });

  it("exit 1 when MERGED but the local tip differs from the PR head (post-squash commit)", () => {
    const { dir } = makeRepo();
    const r = run(
      ["todo/foo"],
      {
        FAKE_GH_STATE: "MERGED",
        FAKE_GH_OID: "0000000000000000000000000000000000000000",
      },
      dir,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT safe to delete");
  });

  it("exit 1 when MERGED but headRefOid is missing (fail-closed)", () => {
    expect(
      run(["todo/foo"], { FAKE_GH_STATE: "MERGED", FAKE_GH_OID: "" }).status,
    ).toBe(1);
  });

  it("exit 1 when the PR is OPEN", () => {
    const r = run(["todo/foo"], {
      FAKE_GH_STATE: "OPEN",
      FAKE_GH_OID: "abc123",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT safe to delete");
  });

  it("exit 1 when the PR is CLOSED without merge", () => {
    expect(
      run(["todo/foo"], { FAKE_GH_STATE: "CLOSED", FAKE_GH_OID: "abc123" })
        .status,
    ).toBe(1);
  });

  it("exit 1 when no PR exists (gh non-zero)", () => {
    const r = run(["todo/foo"], { FAKE_GH_STATE: "", FAKE_GH_EXIT: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT safe to delete");
  });

  it("exit 1 on a hard gh failure (fail-closed)", () => {
    expect(
      run(["todo/foo"], {
        FAKE_GH_STATE: "",
        FAKE_GH_EXIT: "8",
        FAKE_GH_STDERR: "network down",
      }).status,
    ).toBe(1);
  });

  it("exit 1 on a flag-like branch name", () => {
    expect(
      run(["--web"], { FAKE_GH_STATE: "MERGED", FAKE_GH_OID: "abc123" }).status,
    ).toBe(1);
  });

  it("exit 2 with no argument", () => {
    expect(run([], { FAKE_GH_STATE: "MERGED" }).status).toBe(2);
  });
});
