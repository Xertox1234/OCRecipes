import { describe, it, expect } from "vitest";
import { parseSolution } from "../lib/parse";

const BUG = `---
title: "Negative index returns undefined"
track: bug
category: logic-errors
tags: [retry, array-indexing]
module: client
applies_to: ["client/lib/offline-queue-drain.ts"]
symptoms:
  - First attempt fires 8s late
created: 2026-06-12
severity: low
---

# Negative index returns undefined

## Problem
Body text here.

## Root Cause
Because negative.
`;

describe("parseSolution", () => {
  it("parses a well-formed bug file", () => {
    const r = parseSolution(
      BUG,
      "logic-errors/neg-index-2026-06-12.md",
      "2026-06-12",
    );
    expect(r.track).toBe("bug");
    expect(r.category).toBe("logic-errors");
    expect(r.title).toBe("Negative index returns undefined");
    expect(r.slug).toBe("neg-index");
    expect(r.tags).toEqual(["retry", "array-indexing"]);
    expect(r.appliesTo).toEqual(["client/lib/offline-queue-drain.ts"]);
    expect(r.symptoms).toEqual(["First attempt fires 8s late"]);
    expect(r.created).toBe("2026-06-12");
    expect(r.sections["Problem"]).toBe("Body text here.");
    expect(r.sections["Root Cause"]).toBe("Because negative.");
    expect(r.warnings).toEqual([]);
    expect(r.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("derives track/category from the path and title from the slug when frontmatter omits them", () => {
    const raw = `---\ntags: [x]\nmodule: server\n---\n\n# H1 Ignored\n\n## Rule\nDo the thing.\n`;
    const r = parseSolution(
      raw,
      "conventions/use-foo-helper-2026-05-01.md",
      "2026-05-01",
    );
    expect(r.track).toBe("knowledge");
    expect(r.category).toBe("conventions");
    expect(r.title).toBe("use-foo-helper");
    expect(r.created).toBe("2026-05-01");
    expect(r.warnings).toContain("title missing — derived from filename slug");
  });

  it("warns when a bug file lacks severity and when module is absent", () => {
    const raw = `---\ntitle: "X"\ntags: [y]\n---\n\n## Problem\np\n`;
    const r = parseSolution(
      raw,
      "runtime-errors/x-2026-05-02.md",
      "2026-05-02",
    );
    expect(r.track).toBe("bug");
    expect(r.warnings).toContain("module missing");
    expect(r.warnings).toContain("severity missing (required for bug track)");
  });

  it("produces a stable content hash regardless of trailing whitespace", () => {
    const a = parseSolution(
      BUG,
      "logic-errors/neg-index-2026-06-12.md",
      "2026-06-12",
    );
    const b = parseSolution(
      BUG + "\n\n  ",
      "logic-errors/neg-index-2026-06-12.md",
      "2026-06-12",
    );
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("warns when frontmatter track disagrees with directory-derived track", () => {
    const raw = `---\ntitle: "X"\ntags: [y]\nmodule: client\ntrack: knowledge\n---\n\n## Problem\np\n`;
    const r = parseSolution(
      raw,
      "runtime-errors/x-2026-05-02.md",
      "2026-05-02",
    );
    expect(r.track).toBe("bug"); // directory wins
    expect(r.warnings).toContain(
      "frontmatter track 'knowledge' disagrees with directory-derived 'bug'",
    );
  });

  it("recovers good fields when one frontmatter field is malformed", () => {
    const raw = `---\ntitle: "Real Title"\ntags: not-an-array\nmodule: server\n---\n\n## Rule\nbody\n`;
    const r = parseSolution(raw, "conventions/foo-2026-06-01.md", "2026-06-01");
    expect(r.title).toBe("Real Title"); // preserved despite malformed tags
    expect(r.warnings).not.toContain(
      "title missing — derived from filename slug",
    );
    expect(r.warnings).toContain("tags missing"); // tags degraded to absent
  });
});
