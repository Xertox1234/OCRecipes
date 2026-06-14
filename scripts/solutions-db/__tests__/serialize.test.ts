import { describe, it, expect } from "vitest";
import { serializeSolution } from "../lib/serialize";
import {
  parseSolution,
  computeContentHash,
  type ProjectionInput,
} from "../lib/parse";

function roundTripHash(p: ProjectionInput, sourcePath: string): string {
  const md = serializeSolution(p);
  const reparsed = parseSolution(md, sourcePath, p.created);
  return reparsed.contentHash;
}

const proj: ProjectionInput = {
  title: "Negative index returns undefined",
  track: "bug",
  category: "logic-errors",
  module: "client",
  severity: "low",
  tags: ["retry", "array-indexing"],
  symptoms: ["First attempt fires 8s late"],
  appliesTo: ["client/lib/offline-queue-drain.ts"],
  created: "2026-06-12",
  lastUpdated: null,
  extraFields: {},
  body: "## Problem\nBody.\n\n## Root Cause\nBecause negative.",
};

describe("serializeSolution round-trip", () => {
  it("serialize -> parse preserves content_hash", () => {
    expect(roundTripHash(proj, "logic-errors/neg-index-2026-06-12.md")).toBe(
      computeContentHash(proj),
    );
  });
  it("preserves extra_fields (source) through the round-trip", () => {
    const p = {
      ...proj,
      extraFields: { source: "2026-06-10 security audit (S1/S2/S3)" },
    };
    expect(roundTripHash(p, "logic-errors/neg-index-2026-06-12.md")).toBe(
      computeContentHash(p),
    );
  });
  it("preserves last_updated", () => {
    const p = { ...proj, lastUpdated: "2026-06-13" };
    expect(roundTripHash(p, "logic-errors/neg-index-2026-06-12.md")).toBe(
      computeContentHash(p),
    );
  });
});
