import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * scripts/ota-machine-check.js runs before an OTA publish and refuses when
 * the laptop is short of memory (the bundle adds 3–4 GB). It reads the
 * system-wide free percentage from `memory_pressure`, found through PATH, so
 * these tests put a fake one on PATH instead of adding a test-only switch to
 * the check itself.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const script = path.join(repoRoot, "scripts", "ota-machine-check.js");
const nodeDir = path.dirname(process.execPath);

const tmpDirs: string[] = [];

function makeBin(memoryPressureBody: string | null): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "fake-mem-")),
  );
  tmpDirs.push(dir);
  if (memoryPressureBody !== null) {
    const bin = path.join(dir, "memory_pressure");
    fs.writeFileSync(bin, `#!/bin/sh\n${memoryPressureBody}\n`);
    fs.chmodSync(bin, 0o755);
  }
  return dir;
}

function freeAt(percent: number): string {
  return `echo "Pageouts: 1"\necho "System-wide memory free percentage: ${percent}%"`;
}

function run(
  memoryPressureBody: string | null,
  env: Record<string, string> = {},
) {
  const binDir = makeBin(memoryPressureBody);
  // PATH holds only the fake directory, node, and the basic shell tools, so a
  // missing fake cannot fall through to the real /usr/bin/memory_pressure.
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 15_000,
    env: { NODE_ENV: "test", PATH: `${binDir}:${nodeDir}:/bin`, ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("ota-machine-check", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when enough memory is free", () => {
    const r = run(freeAt(55));
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes at exactly the floor", () => {
    const r = run(freeAt(40));
    expect(r.status, r.stderr).toBe(0);
  });

  it("refuses under the floor and says how to override", () => {
    const r = run(freeAt(39));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("39% of memory is free");
    expect(r.stderr).toContain("OTA_ALLOW_BUSY=1");
  });

  it("refuses when the probe prints no free percentage", () => {
    const r = run('echo "nothing useful"');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("could not read free memory");
  });

  it("refuses when the probe fails", () => {
    const r = run("exit 3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("could not read free memory");
  });

  it("OTA_ALLOW_BUSY=1 passes a busy machine, and says so", () => {
    const r = run(freeAt(10), { OTA_ALLOW_BUSY: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("OTA_ALLOW_BUSY=1");
  });

  it("only the exact value 1 overrides", () => {
    const r = run(freeAt(10), { OTA_ALLOW_BUSY: "0" });
    expect(r.status).toBe(1);
  });

  it("with no memory_pressure command: refuses on macOS, skips elsewhere", () => {
    const r = run(null);
    if (process.platform === "darwin") {
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("could not read free memory");
    } else {
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain("skipped");
    }
  });
});
