import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("FSA thresholds live in exactly one place", () => {
  it("declares and re-exports no FSA_ identifier under server/", () => {
    // Matches `export const FSA_x` and `export { ...FSA_x... } from ...`, NOT the
    // multiline `import {` block in universal-flags.ts (those identifiers sit on
    // their own lines), and NOT comments mentioning a threshold.
    // -P (perl), NOT -E: git's POSIX ERE does not support \b or \s as written.
    let out = "";
    try {
      out = execSync("git grep -lP 'export\\s+(const\\s+FSA_|\\{[^}]*FSA_)' -- server/", {
        encoding: "utf8",
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      if (e.status !== 1) throw err; // exit 1 == no matches, which is the pass case
      out = e.stdout ?? "";
    }
    expect(out.split("\n").filter(Boolean)).toEqual([]);
  });
});
