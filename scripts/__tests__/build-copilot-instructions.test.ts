import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  generateInstructions,
  runBuildCli,
} from "../build-copilot-instructions";

const tmpDirs: string[] = [];

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-instructions-"));
  tmpDirs.push(dir);
  return path.join(dir, "copilot-instructions.md");
}

describe("build-copilot-instructions", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it("generates a non-empty instructions file", () => {
    const output = generateInstructions();
    expect(output.length).toBeGreaterThan(500);
    expect(output).toContain("# Copilot Instructions");
  });

  it("includes the OCRecipes stack orientation paragraph", () => {
    const output = generateInstructions();
    expect(output).toContain("Expo");
    expect(output).toContain("PostgreSQL");
  });

  it("includes the path → domain mapping table", () => {
    const output = generateInstructions();
    expect(output).toContain("| Path pattern");
    expect(output).toContain("server/routes");
    expect(output).toContain("react-native");
  });

  it("includes the hard exclusions reminder", () => {
    const output = generateInstructions();
    expect(output).toContain("JWT/auth");
    expect(output).toContain("IAP");
  });

  it("includes the mandatory workflow paragraph", () => {
    const output = generateInstructions();
    expect(output).toContain("Project Rules");
    expect(output).toContain("binding");
  });

  it("stays under the 32 KB / ~8000 token soft cap", () => {
    const output = generateInstructions();
    expect(output.length).toBeLessThan(32_000);
  });

  it("--check exits 0 when target file matches generated output", () => {
    const target = tmpFile();
    fs.writeFileSync(target, generateInstructions());
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = runBuildCli(["--check", target]);
    expect(status).toBe(0);
  });

  it("--check exits non-zero when target file is stale", () => {
    const target = tmpFile();
    fs.writeFileSync(target, "stale content");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = runBuildCli(["--check", target]);
    expect(status).not.toBe(0);
  });

  it("default (no flag) writes the generated output to target path", () => {
    const target = tmpFile();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const status = runBuildCli([target]);
    expect(status).toBe(0);
    expect(fs.readFileSync(target, "utf8")).toEqual(generateInstructions());
  });
});
