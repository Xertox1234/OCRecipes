import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const scriptPath = path.resolve(
  __dirname,
  "..",
  "check-eval-dataset-secrets.js",
);

/**
 * Run the secret-leak check script against a given file path.
 * Returns the process exit code and stderr for assertions.
 */
function runCheck(targetFile: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("node", [scriptPath, targetFile], {
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Track temp directories created during a test so we can clean them up. */
const tmpDirs: string[] = [];

/**
 * Create a dataset file under a temp `evals/datasets/` path so the script's
 * path filter accepts it.
 */
function writeDataset(contents: string): string {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "eval-secrets-check-"));
  tmpDirs.push(tmpBase);
  const dir = path.join(tmpBase, "evals", "datasets");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "cases.json");
  fs.writeFileSync(file, contents);
  return file;
}

describe("check-eval-dataset-secrets.js", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("exits 0 when the dataset contains no secrets or PII", () => {
    const file = writeDataset(
      JSON.stringify([
        { id: "case-1", userMessage: "Eat more vegetables", context: {} },
      ]),
    );
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });

  it("exits 1 when the dataset contains an OpenAI-style key", () => {
    const file = writeDataset(
      JSON.stringify([
        {
          id: "case-1",
          userMessage: "my API key is sk-abcdefghijklmnop",
          context: {},
        },
      ]),
    );
    const { status, stderr } = runCheck(file);
    expect(status).toBe(1);
    expect(stderr).toContain("OpenAI-style API key");
  });

  it("exits 1 when the dataset contains an email address", () => {
    const file = writeDataset(
      JSON.stringify([
        {
          id: "case-1",
          userMessage: "email me at real.person@example.com",
          context: {},
        },
      ]),
    );
    const { status, stderr } = runCheck(file);
    expect(status).toBe(1);
    expect(stderr).toContain("Email address");
  });

  it("exits 1 when the dataset contains a Bearer token", () => {
    const file = writeDataset(
      JSON.stringify([
        {
          id: "case-1",
          userMessage: "Authorization: Bearer abcdef1234567890",
          context: {},
        },
      ]),
    );
    const { status, stderr } = runCheck(file);
    expect(status).toBe(1);
    expect(stderr).toContain("Bearer token");
  });

  it("exits 1 when the dataset contains a phone number", () => {
    const file = writeDataset(
      JSON.stringify([
        { id: "case-1", userMessage: "call me at 555-123-4567", context: {} },
      ]),
    );
    const { status, stderr } = runCheck(file);
    expect(status).toBe(1);
    expect(stderr).toContain("Phone number");
  });

  it("respects the allow-secret opt-out comment", () => {
    // JSON doesn't support comments, but the script reads lines — so a line
    // containing `allow-secret` is skipped regardless of file type.
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "eval-secrets-check-"),
    );
    tmpDirs.push(tmpBase);
    const dir = path.join(tmpBase, "evals", "datasets");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "cases.json");
    // Write a JSON5-ish file with a comment that's never parsed as JSON by
    // the script (it only scans lines). allow-secret should suppress detection.
    fs.writeFileSync(
      file,
      `[\n  // allow-secret: sk-abcdefghijklmnop\n  {}\n]\n`,
    );
    const { status } = runCheck(file);
    expect(status).toBe(0);
  });
});
