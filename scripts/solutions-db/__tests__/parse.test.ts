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

  it("does not throw on malformed YAML frontmatter; falls back to body-only with a warning", () => {
    const raw = `---\ntitle: "Y"\ntags: [z]\nmodule: client\nsymptoms:\n  - *.tsx files break\n---\n\n## Problem\np\n`;
    const r = parseSolution(
      raw,
      "logic-errors/bad-yaml-2026-06-01.md",
      "2026-06-01",
    );
    expect(r.track).toBe("bug");
    expect(r.warnings.some((w) => w.includes("frontmatter parse error"))).toBe(
      true,
    );
    expect(r.title).toBe("bad-yaml"); // body-only fallback derives title from slug
    expect(r.sections["Problem"]).toBe("p");
  });
});

describe("parseSolution — variant keys + extra_fields", () => {
  const withVariants = `---
title: Reverse proxy collapsed rate limiters
date: 2026-06-10
category: logic-errors
tags: [security, rate-limiting]
severity: high
source: 2026-06-10 security audit (S1/S2/S3)
---

## Problem
Body.
`;

  it("maps date -> created and records a warning", () => {
    const r = parseSolution(
      withVariants,
      "logic-errors/rev-proxy-2026-06-10.md",
      "2026-06-11",
    );
    expect(r.created).toBe("2026-06-10");
    expect(r.warnings).toContain("created derived from `date:` variant key");
  });

  it("routes unknown keys (source) into extraFields verbatim", () => {
    const r = parseSolution(
      withVariants,
      "logic-errors/rev-proxy-2026-06-10.md",
      "2026-06-11",
    );
    expect(r.extraFields).toEqual({
      source: "2026-06-10 security audit (S1/S2/S3)",
    });
  });

  it("maps updated -> last_updated and records a warning", () => {
    const raw = `---
title: T
track: bug
category: logic-errors
tags: [zod]
created: 2026-05-29
updated: 2026-05-31
severity: medium
---

## Problem
B.
`;
    const r = parseSolution(
      raw,
      "logic-errors/zod-2026-05-29.md",
      "2026-05-29",
    );
    expect(r.lastUpdated).toBe("2026-05-31");
    expect(r.warnings).toContain(
      "last_updated derived from `updated:` variant key",
    );
    expect(r.extraFields).toEqual({});
  });
});
