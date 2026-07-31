import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("FSA thresholds live in exactly one place", () => {
  it("declares and re-exports no FSA_ identifier under server/", () => {
    // Matches a declared FSA_ constant or a re-export of one, NOT the
    // multiline `import {` block in universal-flags.ts (those identifiers sit on
    // their own lines), and NOT comments mentioning a threshold value. (This
    // comment is itself worded to avoid tripping its own pattern — an earlier
    // draft that spelled the pattern out literally in a code-quoted example
    // self-matched and false-failed the guard.)
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
