import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "ci", "e2e-with-flow-retry.sh");

// Real verdict lines from run 33397038006 (names must map to real flow files).
const FAILED_TABS =
  '[Failed] Home - Navigate between tabs (1m 20s) (Assertion is false: "(Sign In|Hello.*)" is visible)';
const FAILED_DETAIL =
  '[Failed] Home - View item detail from history (1m 9s) (Assertion is false: "Sign In" is not visible)';
const PASSED_LOGIN = "[Passed] Auth - Login flow (1m 23s)";

/**
 * The iOS job runs this script under macOS's default /bin/bash 3.2, so every
 * behavioral case invokes it the same way with stubbed `npm` and `maestro`
 * ahead on PATH. The `npm` stub prints a canned suite transcript and exits
 * with a canned code; the `maestro` stub records its argv and exits per env.
 */
describe("scripts/ci/e2e-with-flow-retry.sh", () => {
  let stubDir: string;
  let maestroLog: string;

  function writeStub(name: string, body: string) {
    const p = path.join(stubDir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }

  function run(suiteTranscript: string, suiteExit: number, maestroExit = 0) {
    writeStub("npm", `cat <<'EOF'\n${suiteTranscript}\nEOF\nexit ${suiteExit}`);
    writeStub(
      "maestro",
      `printf '%s\\n' "$*" >> "${maestroLog}"\nexit ${maestroExit}`,
    );
    const res = spawnSync("/bin/bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
    });
    const calls = existsSync(maestroLog)
      ? readFileSync(maestroLog, "utf8").trim().split("\n").filter(Boolean)
      : [];
    return {
      status: res.status,
      stdout: res.stdout,
      stderr: res.stderr,
      calls,
    };
  }

  beforeEach(() => {
    stubDir = mkdtempSync(path.join(tmpdir(), "e2e-retry-stubs-"));
    maestroLog = path.join(stubDir, "maestro-calls.log");
  });

  afterEach(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it("exits 0 and never re-runs anything when the suite is green", () => {
    const r = run(`${PASSED_LOGIN}\n0/8 Flows Failed`, 0);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("re-runs exactly the failed flows by file and exits 0 when they pass", () => {
    const r = run(
      [PASSED_LOGIN, FAILED_TABS, FAILED_DETAIL, "2/8 Flows Failed"].join("\n"),
      1,
    );
    expect(r.stderr).not.toMatch(/mapfile|unbound variable/);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(
      r.calls.some((c) => c.endsWith("e2e/flows/home/navigate-tabs.yaml")),
    ).toBe(true);
    expect(
      r.calls.some((c) => c.endsWith("e2e/flows/home/view-item-detail.yaml")),
    ).toBe(true);
    for (const c of r.calls) {
      expect(c).toContain("-e USERNAME=");
      expect(c).toContain("--flatten-debug-output");
    }
  });

  it("exits nonzero when a re-run fails too", () => {
    const r = run([FAILED_TABS, "1/8 Flows Failed"].join("\n"), 1, 1);
    expect(r.status).not.toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.stdout).toMatch(/failed twice: Home - Navigate between tabs/);
  });

  it("treats a failing suite with no [Failed] lines as an infrastructure failure: nonzero, nothing re-run", () => {
    const r = run("IOSDriverTimeoutException: iOS driver not ready in time", 1);
    expect(r.status).not.toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/infrastructure failure/);
  });

  it("--parse-only maps verdict lines to flow files and strips ANSI", () => {
    const log = path.join(stubDir, "suite.log");
    writeFileSync(log, `[31m${FAILED_TABS}[0m\n${PASSED_LOGIN}\n`);
    const res = spawnSync("/bin/bash", [SCRIPT, "--parse-only", log], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(
      "Home - Navigate between tabs => e2e/flows/home/navigate-tabs.yaml",
    );
  });

  it("uses no bash-4-only builtins (the iOS job runs under macOS bash 3.2)", () => {
    // Comments may legitimately mention the forbidden builtins (the script
    // documents why it avoids mapfile) — guard the executable text only.
    const src = readFileSync(SCRIPT, "utf8")
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(src).not.toMatch(
      /\bmapfile\b|\breadarray\b|declare -A|\$\{[a-zA-Z_]+(,,|\^\^)\}/,
    );
  });
});
