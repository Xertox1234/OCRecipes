import { describe, it, expect } from "vitest";
import {
  canonicalProjection,
  computeContentHash,
  type ProjectionInput,
} from "../lib/parse";

const base: ProjectionInput = {
  title: "T",
  track: "bug",
  category: "logic-errors",
  module: "server",
  severity: "low",
  tags: ["a", "b"],
  symptoms: ["s1"],
  appliesTo: ["server/**/*.ts"],
  created: "2026-06-13",
  lastUpdated: null,
  extraFields: { source: "audit X" },
  body: "  body text  ",
};

describe("canonicalProjection / computeContentHash", () => {
  it("is stable for identical input", () => {
    expect(computeContentHash(base)).toBe(computeContentHash({ ...base }));
  });
  it("is independent of extra_fields key insertion order", () => {
    const a = { ...base, extraFields: { source: "x", origin: "y" } };
    const b = { ...base, extraFields: { origin: "y", source: "x" } };
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });
  it("trims the body (formatting whitespace is not content)", () => {
    expect(computeContentHash(base)).toBe(
      computeContentHash({ ...base, body: "body text" }),
    );
  });
  it("treats tag reordering as a real change", () => {
    expect(computeContentHash(base)).not.toBe(
      computeContentHash({ ...base, tags: ["b", "a"] }),
    );
  });
  it("changes when an extra field value changes", () => {
    expect(computeContentHash(base)).not.toBe(
      computeContentHash({ ...base, extraFields: { source: "audit Y" } }),
    );
  });
  it("returns a 64-char hex digest", () => {
    expect(computeContentHash(base)).toMatch(/^[a-f0-9]{64}$/);
  });
});
