import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "verify-branch-merged.sh");

// Fake `gh` controlled by env: FAKE_GH_STATE (echoed), FAKE_GH_EXIT (exit code).
const FAKE_GH = `#!/usr/bin/env bash
if [ "\${FAKE_GH_EXIT:-0}" != "0" ]; then
  echo "\${FAKE_GH_STDERR:-no pull requests found for branch}" >&2
  exit "$FAKE_GH_EXIT"
fi
printf '%s\\n' "$FAKE_GH_STATE"
exit 0
`;

let tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

function run(branch: string[], env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
  return spawnSync("bash", [SCRIPT, ...branch], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
  });
}

describe("verify-branch-merged.sh", () => {
  it("exit 0 when the fresh PR state is MERGED", () => {
    const r = run(["todo/foo"], { FAKE_GH_STATE: "MERGED" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MERGED");
  });

  it("exit 1 when the PR is OPEN", () => {
    const r = run(["todo/foo"], { FAKE_GH_STATE: "OPEN" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT safe to delete");
  });

  it("exit 1 when the PR is CLOSED without merge", () => {
    expect(run(["todo/foo"], { FAKE_GH_STATE: "CLOSED" }).status).toBe(1);
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

  it("exit 2 with no argument", () => {
    expect(run([], { FAKE_GH_STATE: "MERGED" }).status).toBe(2);
  });
});
