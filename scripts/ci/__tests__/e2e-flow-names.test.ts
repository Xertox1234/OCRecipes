import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "e2e");

/**
 * Maestro writes each flow's debug output (screenshots, commands.json) into a
 * folder named after the flow's `name:`. actions/upload-artifact refuses a
 * path containing any of these characters and fails the whole upload, so one
 * such name removes the debug output of every flow in a failing run (seen in
 * runs 43974790714 and 43981529576, where a name ended in "?").
 */
const ARTIFACT_FORBIDDEN = /[":<>|*?\r\n]/;

function flowFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return flowFiles(full);
    return entry.name.endsWith(".yaml") ? [full] : [];
  });
}

function flowName(file: string): string | null {
  const match = /^name:\s*(.+?)\s*$/m.exec(readFileSync(file, "utf8"));
  if (!match) return null;
  return match[1].replace(/^(["'])(.*)\1$/, "$2");
}

describe("E2E flow names", () => {
  const named = flowFiles(E2E_DIR)
    .map((file) => ({
      file: path.relative(REPO_ROOT, file),
      name: flowName(file),
    }))
    .filter((flow): flow is { file: string; name: string } => !!flow.name);

  it("finds the named flows", () => {
    expect(named.length).toBeGreaterThanOrEqual(10);
  });

  it("uses no character that upload-artifact rejects in a path", () => {
    const bad = named.filter((flow) => ARTIFACT_FORBIDDEN.test(flow.name));
    expect(bad).toEqual([]);
  });

  it("has no ' (' in a name, where the retry script cuts the name off", () => {
    // scripts/ci/e2e-with-flow-retry.sh reads "[Failed] <name> (1m 2s) (...)".
    const bad = named.filter((flow) => flow.name.includes(" ("));
    expect(bad).toEqual([]);
  });
});
