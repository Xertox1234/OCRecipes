import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// This file scans server/ for FSA_ identifiers, so it is excluded from its
// own scan by path — structurally, not by relying on how any comment in it
// happens to be worded. (An earlier draft quoted the match pattern as a
// literal code example in a comment and self-matched; comment-stripping
// below closes that class of bug for every OTHER file, but excluding this
// file by path means this guard can never alarm on itself regardless of
// what prose future edits add here.)
const GUARD_FILE = "server/services/__tests__/no-server-fsa-constants.test.ts";

/**
 * Given repo-root-relative paths, returns the subset whose whole-file text
 * (comments stripped) declares, locally redeclares, or re-exports an FSA_
 * identifier.
 *
 * Reads whole files rather than scanning line-by-line (unlike `git grep -l`)
 * so a Prettier-wrapped multi-line re-export —
 *   export {
 *     FSA_FOOD,
 *   } from "@shared/constants/nutrition-bands";
 * — is still caught: no single LINE carries `export` + `{` + `FSA_`
 * together, but the whole file does. Comments are stripped first so prose
 * that merely mentions a threshold value (e.g. "// FSA_FOOD.sugar (22.5)")
 * is not mistaken for a declaration.
 */
function offendersIn(paths: string[]): string[] {
  return paths.filter((relPath) => {
    const stripped = readFileSync(relPath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/\/\/.*$/gm, ""); // line comments
    return (
      /\bconst\s+FSA_[A-Z]/.test(stripped) ||
      /export\s*\{[^}]*FSA_[A-Z]/.test(stripped) ||
      /export\s*\*\s*from\s*["']@shared\/constants\/nutrition-bands/.test(
        stripped,
      )
    );
  });
}

/** All tracked server/ source files, excluding this guard itself. */
function serverSourceFiles(): string[] {
  return execSync("git ls-files server/", { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => f !== GUARD_FILE);
}

describe("FSA thresholds live in exactly one place", () => {
  it("declares, locally redeclares, and re-exports no FSA_ identifier under server/", () => {
    expect(offendersIn(serverSourceFiles())).toEqual([]);
  });

  it("is not scanning zero files (a broken pathspec or cwd would pass vacuously otherwise)", () => {
    expect(serverSourceFiles().length).toBeGreaterThan(0);
  });

  it("the matcher actually matches a real FSA_ declaration (positive control)", () => {
    // Runs the SAME offendersIn() logic the guard above uses, against the
    // real shared source of truth (not a hand-written fixture that could
    // drift from it). If this goes green-empty, the matcher is broken and
    // the guard above is vacuous, not passing.
    expect(offendersIn(["shared/constants/nutrition-bands.ts"])).toEqual([
      "shared/constants/nutrition-bands.ts",
    ]);
  });
});
