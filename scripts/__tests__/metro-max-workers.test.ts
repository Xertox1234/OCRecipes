import { describe, it, expect } from "vitest";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * metro.config.js caps Metro's transform workers when METRO_MAX_WORKERS is
 * set. Only the OTA publish scripts set it, so the dev server, E2E and native
 * builds keep Metro's default. The config is loaded in a child process
 * because it reads the variable at require time.
 */

const repoRoot = path.resolve(__dirname, "..", "..");

function maxWorkersWith(value: string | undefined): string {
  const env = { ...process.env };
  delete env.METRO_MAX_WORKERS;
  if (value !== undefined) env.METRO_MAX_WORKERS = value;
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      'process.stdout.write("MAX=" + String(require("./metro.config.js").maxWorkers))',
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000, env },
  );
  expect(result.status, result.stderr).toBe(0);
  const match = /MAX=(\S+)/.exec(result.stdout);
  expect(match, result.stdout).not.toBeNull();
  return match![1];
}

describe("metro.config.js METRO_MAX_WORKERS", () => {
  const unset = maxWorkersWith(undefined);

  it("applies a whole number", () => {
    expect(maxWorkersWith("2")).toBe("2");
  });

  it.each(["", "0", "-1", "abc", "2.5", "2x"])(
    "ignores %j and keeps the default",
    (value) => {
      expect(maxWorkersWith(value)).toBe(unset);
    },
  );
});
