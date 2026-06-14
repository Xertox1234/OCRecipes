import { describe, it, expect } from "vitest";
import { compareParity } from "../lib/parity";

const row = (
  source_path: string,
  content_hash: string,
  has_embedding = true,
) => ({
  source_path,
  content_hash,
  has_embedding,
});

describe("compareParity", () => {
  it("passes when disk and db match", () => {
    const r = compareParity(new Map([["a.md", "h1"]]), [row("a.md", "h1")]);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });
  it("flags a hash mismatch by path", () => {
    const r = compareParity(new Map([["a.md", "h1"]]), [row("a.md", "h2")]);
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("hash mismatch: a.md");
  });
  it("flags a file missing from the db", () => {
    const r = compareParity(new Map([["a.md", "h1"]]), []);
    expect(r.failures.join()).toContain("missing in DB: a.md");
  });
  it("flags a db row with no disk file", () => {
    const r = compareParity(new Map(), [row("a.md", "h1")]);
    expect(r.failures.join()).toContain("in DB but not on disk: a.md");
  });
  it("flags NULL embeddings", () => {
    const r = compareParity(new Map([["a.md", "h1"]]), [
      row("a.md", "h1", false),
    ]);
    expect(r.failures.join()).toContain("NULL embedding");
  });
});
