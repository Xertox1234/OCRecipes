import { describe, it, expect } from "vitest";
import { parseRecentArgs } from "../lib/recent-args";

describe("parseRecentArgs", () => {
  it("defaults to k=20 and no filters when given no args", () => {
    expect(parseRecentArgs([])).toEqual({ filters: {}, k: 20 });
  });

  it("ignores a bare `--` separator (npm passes it through)", () => {
    expect(parseRecentArgs(["--", "--track", "bug"])).toEqual({
      filters: { track: "bug" },
      k: 20,
    });
  });

  it("parses days, track, category, and limit together", () => {
    expect(
      parseRecentArgs([
        "--days",
        "14",
        "--track",
        "knowledge",
        "--category",
        "conventions",
        "--limit",
        "5",
      ]),
    ).toEqual({
      filters: { days: 14, track: "knowledge", category: "conventions" },
      k: 5,
    });
  });

  it("throws on a non-numeric --days", () => {
    expect(() => parseRecentArgs(["--days", "foo"])).toThrow(
      '--days must be a positive integer (got "foo")',
    );
  });

  it("throws on a non-integer --limit (e.g. 2.5)", () => {
    expect(() => parseRecentArgs(["--limit", "2.5"])).toThrow(
      '--limit must be a positive integer (got "2.5")',
    );
  });

  it("throws on a non-positive --limit (e.g. -5)", () => {
    expect(() => parseRecentArgs(["--limit", "-5"])).toThrow(
      '--limit must be a positive integer (got "-5")',
    );
  });

  it("throws on a zero --days", () => {
    expect(() => parseRecentArgs(["--days", "0"])).toThrow(
      '--days must be a positive integer (got "0")',
    );
  });

  it("throws on an invalid --track value", () => {
    expect(() => parseRecentArgs(["--track", "bugs"])).toThrow(
      '--track must be "bug" or "knowledge" (got "bugs")',
    );
  });
});
