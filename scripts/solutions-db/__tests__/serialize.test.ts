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

  it("emits INLINE flow-style tags (grep-readable for the markdown fallback)", () => {
    const md = serializeSolution({ ...proj, tags: ["api", "404"] });
    // must be `tags: [api, '404']` on one line — NOT block `tags:\n  - api`
    expect(md).toMatch(/^tags: \[/m);
    expect(md).not.toMatch(/^tags:\s*$/m);
  });

  it("round-trips numeric-coerced tags (the quoted '404' case)", () => {
    const p = { ...proj, tags: ["api", "404"] };
    expect(roundTripHash(p, "logic-errors/x-2026-06-12.md")).toBe(
      computeContentHash(p),
    );
  });
});
