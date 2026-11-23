# Solutions Database SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the 487 `docs/solutions/` markdown files into a local PostgreSQL database (`ocrecipes_solutions`) with semantic search exposed to Claude Code via a custom read-only MCP server — the markdown files stay canonical (cut-over is SP2).

**Architecture:** A self-contained module under `scripts/solutions-db/`, decoupled from the app (own DB, own OpenAI client, never touches `shared/schema.ts`). Pure parsing/matching/clustering modules are unit-tested (CI-safe, DB+API mocked); DB-dependent orchestration (ingest, dedup report, MCP server, integration check) is verified against a real local DB. Embeddings via OpenAI `text-embedding-3-small` (1536-d), stored in a `pgvector` column.

**Tech Stack:** TypeScript + `tsx`, `pg`, `pgvector`/`pg_trgm`, `gray-matter` (new), `@modelcontextprotocol/sdk` v1.29.0 (new), `zod`, `vitest`, OpenAI SDK.

**Spec:** `docs/superpowers/specs/2026-06-12-solutions-database-sp1-design.md`

**Branch:** Do all work on `feat/solutions-db-sp1` (branch protection rejects direct pushes to `main`).

---

## File Structure

```
scripts/solutions-db/
  schema.sql               # DDL: extensions, enums, solutions table, indexes, solutions_ro role
  lib/
    parse.ts               # PURE: frontmatter parse, section split, field derivation, content hash
    globs.ts               # PURE: applies_to matcher mirroring inject-patterns.sh bash semantics
    dedup.ts               # PURE: union-find clustering from similarity pairs
    sql-guard.ts           # PURE: read-only SELECT/WITH guard for the `sql` MCP tool
    embeddings.ts          # lazy OpenAI client; embedding-text builder + truncation + chunked batch
    db.ts                  # lazy pg Pool factory + pgvector literal helper
  ingest.ts                # solutions:db:ingest — walk → parse → embed-on-change → upsert
  dedup-report.ts          # solutions:db:dedup — exact + cosine clusters → _manifests report
  mcp-server.ts            # 7 read-only MCP tools over the read-only role
  integration-check.ts     # solutions:db:check — standalone real-DB assertion script
  __tests__/
    parse.test.ts
    globs.test.ts
    dedup.test.ts
    sql-guard.test.ts
    embeddings.test.ts
.mcp.json                  # repo-root MCP wiring (committed; no secrets, ${VAR} interpolation)
```

**Decomposition rationale:** the five `lib/*` files each have one responsibility and are pure enough to unit-test without a DB or network (`db.ts`/`embeddings.ts` build their pool/client **lazily** so importing them during `vitest run` collection never opens a connection). The four top-level scripts are thin orchestration over those libs.

---

### Task 1: Project setup — branch, deps, dirs, npm scripts

**Files:**

- Modify: `package.json` (dependencies + scripts)
- Create: `scripts/solutions-db/` (+ `lib/`, `__tests__/`)

- [ ] **Step 1: Create the feature branch**

```bash
git switch -c feat/solutions-db-sp1
```

- [ ] **Step 2: Install the two new dependencies**

```bash
npm install gray-matter @modelcontextprotocol/sdk
```

- [ ] **Step 3: Verify the installs resolved**

Run: `node -e "console.log(require('gray-matter/package.json').version, require('@modelcontextprotocol/sdk/package.json').version)"`
Expected: two version strings print (sdk ≥ `1.29.0`), no error.

- [ ] **Step 4: Create directories**

```bash
mkdir -p scripts/solutions-db/lib scripts/solutions-db/__tests__
```

- [ ] **Step 5: Add npm scripts to `package.json`**

Add these entries to the `"scripts"` block (place near the existing `seed:recipes` line):

```json
"solutions:db:init": "psql \"$SOLUTIONS_DATABASE_URL\" -v ON_ERROR_STOP=1 -f scripts/solutions-db/schema.sql",
"solutions:db:ingest": "tsx scripts/solutions-db/ingest.ts",
"solutions:db:dedup": "tsx scripts/solutions-db/dedup-report.ts",
"solutions:db:check": "tsx scripts/solutions-db/integration-check.ts"
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(solutions-db): add deps and npm scripts for solutions database (SP1)"
```

---

### Task 2: `lib/parse.ts` — frontmatter parsing, derivation, hashing (PURE)

**Files:**

- Create: `scripts/solutions-db/lib/parse.ts`
- Test: `scripts/solutions-db/__tests__/parse.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// scripts/solutions-db/__tests__/parse.test.ts
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
    expect(r.track).toBe("knowledge"); // derived from "conventions"
    expect(r.category).toBe("conventions");
    expect(r.title).toBe("use-foo-helper"); // derived from slug
    expect(r.created).toBe("2026-05-01"); // derived from filename date
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/solutions-db/__tests__/parse.test.ts`
Expected: FAIL with "Cannot find module '../lib/parse'".

- [ ] **Step 3: Implement `lib/parse.ts`**

```ts
// scripts/solutions-db/lib/parse.ts
import { createHash } from "node:crypto";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod";

export type Track = "bug" | "knowledge";
export type Category =
  | "logic-errors"
  | "runtime-errors"
  | "code-quality"
  | "performance-issues"
  | "conventions"
  | "design-patterns"
  | "best-practices";

export interface ParsedSolution {
  sourcePath: string;
  slug: string;
  title: string;
  track: Track;
  category: Category;
  module: string | null;
  severity: string | null;
  tags: string[];
  symptoms: string[];
  appliesTo: string[];
  created: string; // YYYY-MM-DD
  lastUpdated: string | null;
  body: string;
  sections: Record<string, string>;
  contentHash: string;
  warnings: string[];
}

const BUG_CATS = new Set<Category>([
  "logic-errors",
  "runtime-errors",
  "code-quality",
  "performance-issues",
]);
const KNOWLEDGE_CATS = new Set<Category>([
  "conventions",
  "design-patterns",
  "best-practices",
]);
const ALL_CATS = new Set<string>([...BUG_CATS, ...KNOWLEDGE_CATS]);

const FrontmatterSchema = z
  .object({
    title: z.string().optional(),
    track: z.enum(["bug", "knowledge"]).optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    module: z.string().optional(),
    applies_to: z.array(z.string()).optional(),
    symptoms: z.array(z.string()).optional(),
    created: z.union([z.string(), z.date()]).optional(),
    last_updated: z.union([z.string(), z.date()]).optional(),
    severity: z.string().optional(),
  })
  .passthrough();

export function deriveSlug(fileName: string): string {
  return fileName.replace(/\.md$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function dateFromFileName(fileName: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})\.md$/.exec(fileName);
  return m ? m[1] : null;
}

function toISODate(v: string | Date | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

export function splitSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) out[cur] = buf.join("\n").trim();
  };
  for (const line of body.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      cur = m[1];
      buf = [];
    } else if (cur !== null) buf.push(line);
  }
  flush();
  return out;
}

export function computeContentHash(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

/** Pure: parse raw file content. `mtimeISO` is the last-resort `created` fallback. */
export function parseSolution(
  raw: string,
  sourcePath: string,
  mtimeISO: string,
): ParsedSolution {
  const warnings: string[] = [];
  const fileName = basename(sourcePath);
  const slug = deriveSlug(fileName);

  const parsed = matter(raw);
  const fm = FrontmatterSchema.safeParse(parsed.data);
  const data = fm.success ? fm.data : {};
  if (!fm.success)
    warnings.push(
      "frontmatter failed schema validation; using best-effort values",
    );

  // category/track derived from the directory (authoritative), cross-checked with frontmatter.
  const category = (sourcePath.split("/")[0] || "") as Category;
  if (!ALL_CATS.has(category))
    warnings.push(`unknown category directory: ${category}`);
  const track: Track = BUG_CATS.has(category) ? "bug" : "knowledge";
  if (data.track && data.track !== track)
    warnings.push(
      `frontmatter track '${data.track}' disagrees with directory-derived '${track}'`,
    );

  let title = data.title ?? "";
  if (!title) {
    title = slug;
    warnings.push("title missing — derived from filename slug");
  }

  const created =
    toISODate(data.created) ?? dateFromFileName(fileName) ?? mtimeISO;
  if (!toISODate(data.created))
    warnings.push("created missing — derived from filename/mtime");

  const module = data.module ?? null;
  if (!module) warnings.push("module missing");
  const severity = data.severity ?? null;
  if (track === "bug" && !severity)
    warnings.push("severity missing (required for bug track)");
  const tags = data.tags ?? [];
  if (tags.length === 0) warnings.push("tags missing");

  return {
    sourcePath,
    slug,
    title,
    track,
    category,
    module,
    severity,
    tags,
    symptoms: data.symptoms ?? [],
    appliesTo: data.applies_to ?? [],
    created,
    lastUpdated: toISODate(data.last_updated),
    body: parsed.content.trim(),
    sections: splitSections(parsed.content),
    contentHash: computeContentHash(raw),
    warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/parse.ts scripts/solutions-db/__tests__/parse.test.ts
git commit -m "feat(solutions-db): pure frontmatter parser with field derivation + content hash"
```

---

### Task 3: `lib/globs.ts` — applies_to matcher mirroring the hook (PURE)

**Files:**

- Create: `scripts/solutions-db/lib/globs.ts`
- Test: `scripts/solutions-db/__tests__/globs.test.ts`

**Why these exact semantics:** `find_by_applies_to` previews `inject-patterns.sh:164-186`, which matches with bash `[[ "$path" == $glob ]]`. In bash 3.2 `[[ ]]`, `*` matches any string **including `/`**, and `**` ≡ `*`, so the literal `/` separators in a glob are required. We replicate that — NOT standard globstar — so the preview is faithful. The test below locks the consequential case: `client/**/*.tsx` does **not** match `client/Foo.tsx` (zero intermediate segments), exactly as bash behaves.

- [ ] **Step 1: Write failing tests**

```ts
// scripts/solutions-db/__tests__/globs.test.ts
import { describe, it, expect } from "vitest";
import { matchesAnyGlob, globToRegExp } from "../lib/globs";

describe("globToRegExp (bash [[ == ]] semantics)", () => {
  it("matches an exact path", () => {
    expect(
      matchesAnyGlob("client/lib/offline-queue-drain.ts", [
        "client/lib/offline-queue-drain.ts",
      ]),
    ).toBe(true);
  });
  it("treats * as spanning slashes within a segment-required pattern", () => {
    expect(matchesAnyGlob("client/a/b/Foo.tsx", ["client/**/*.tsx"])).toBe(
      true,
    );
    expect(matchesAnyGlob("client/a/Foo.tsx", ["client/**/*.tsx"])).toBe(true);
  });
  it("does NOT match zero intermediate segments (mirrors bash, required literal /)", () => {
    expect(matchesAnyGlob("client/Foo.tsx", ["client/**/*.tsx"])).toBe(false);
  });
  it("does not match a different extension", () => {
    expect(matchesAnyGlob("client/a/Foo.ts", ["client/**/*.tsx"])).toBe(false);
  });
  it("escapes regex metacharacters in literal parts", () => {
    expect(
      globToRegExp("server/routes/_helpers.ts").test(
        "server/routes/_helpers.ts",
      ),
    ).toBe(true);
    expect(
      globToRegExp("server/routes/_helpers.ts").test(
        "server/routesXhelpersZts",
      ),
    ).toBe(false);
  });
  it("returns false when applies_to is empty", () => {
    expect(matchesAnyGlob("anything.ts", [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/solutions-db/__tests__/globs.test.ts`
Expected: FAIL with "Cannot find module '../lib/globs'".

- [ ] **Step 3: Implement `lib/globs.ts`**

```ts
// scripts/solutions-db/lib/globs.ts
// Mirrors inject-patterns.sh:164-186 — bash [[ "$path" == $glob ]] where `*`
// (and `**`) match any run of characters INCLUDING `/`, so literal `/`
// separators in the glob are required. This is intentionally NOT globstar.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      while (glob[i + 1] === "*") i++; // collapse a run of * into one
      re += ".*";
    } else if (c === "?") {
      re += ".";
    } else {
      re += c.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

export function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/globs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/globs.ts scripts/solutions-db/__tests__/globs.test.ts
git commit -m "feat(solutions-db): applies_to glob matcher mirroring inject-patterns.sh bash semantics"
```

---

### Task 4: `lib/dedup.ts` — union-find clustering (PURE)

**Files:**

- Create: `scripts/solutions-db/lib/dedup.ts`
- Test: `scripts/solutions-db/__tests__/dedup.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// scripts/solutions-db/__tests__/dedup.test.ts
import { describe, it, expect } from "vitest";
import { clusterByPairs } from "../lib/dedup";

describe("clusterByPairs", () => {
  it("groups transitively connected pairs into one cluster", () => {
    const clusters = clusterByPairs([
      { a: "x", b: "y", sim: 0.95 },
      { a: "y", b: "z", sim: 0.91 },
      { a: "p", b: "q", sim: 0.9 },
    ]);
    expect(clusters).toContainEqual(["x", "y", "z"]);
    expect(clusters).toContainEqual(["p", "q"]);
    expect(clusters).toHaveLength(2);
  });
  it("returns no clusters when there are no pairs", () => {
    expect(clusterByPairs([])).toEqual([]);
  });
  it("omits singletons (only size>=2 clusters)", () => {
    const clusters = clusterByPairs([{ a: "a", b: "b", sim: 0.9 }]);
    expect(clusters).toEqual([["a", "b"]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/solutions-db/__tests__/dedup.test.ts`
Expected: FAIL with "Cannot find module '../lib/dedup'".

- [ ] **Step 3: Implement `lib/dedup.ts`**

```ts
// scripts/solutions-db/lib/dedup.ts
export interface SimPair {
  a: string;
  b: string;
  sim: number;
}

export function clusterByPairs(pairs: SimPair[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of pairs) union(p.a, p.b);

  const groups = new Map<string, string[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => g.sort());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/dedup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/dedup.ts scripts/solutions-db/__tests__/dedup.test.ts
git commit -m "feat(solutions-db): union-find clustering for dedup report"
```

---

### Task 5: `lib/sql-guard.ts` — read-only query guard (PURE)

**Files:**

- Create: `scripts/solutions-db/lib/sql-guard.ts`
- Test: `scripts/solutions-db/__tests__/sql-guard.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// scripts/solutions-db/__tests__/sql-guard.test.ts
import { describe, it, expect } from "vitest";
import { isReadOnlyQuery } from "../lib/sql-guard";

describe("isReadOnlyQuery", () => {
  it("accepts a plain SELECT", () => {
    expect(
      isReadOnlyQuery(
        "SELECT * FROM solutions WHERE category = 'logic-errors'",
      ),
    ).toBe(true);
  });
  it("accepts a leading CTE", () => {
    expect(isReadOnlyQuery("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(true);
  });
  it("accepts a trailing semicolon", () => {
    expect(isReadOnlyQuery("SELECT 1;")).toBe(true);
  });
  it("does not flag column names containing keyword substrings", () => {
    expect(isReadOnlyQuery("SELECT created, last_updated FROM solutions")).toBe(
      true,
    );
  });
  it("rejects writes", () => {
    for (const q of [
      "INSERT INTO solutions DEFAULT VALUES",
      "UPDATE solutions SET title='x'",
      "DELETE FROM solutions",
      "DROP TABLE solutions",
      "TRUNCATE solutions",
      "ALTER TABLE solutions ADD COLUMN z int",
    ])
      expect(isReadOnlyQuery(q)).toBe(false);
  });
  it("rejects multiple statements", () => {
    expect(isReadOnlyQuery("SELECT 1; DROP TABLE solutions")).toBe(false);
  });
  it("rejects a data-modifying CTE", () => {
    expect(
      isReadOnlyQuery(
        "WITH x AS (DELETE FROM solutions RETURNING *) SELECT * FROM x",
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/solutions-db/__tests__/sql-guard.test.ts`
Expected: FAIL with "Cannot find module '../lib/sql-guard'".

- [ ] **Step 3: Implement `lib/sql-guard.ts`**

```ts
// scripts/solutions-db/lib/sql-guard.ts
// Heuristic guard for the `sql` MCP tool. The HARD guarantee is the
// solutions_ro SELECT-only role; this is defense-in-depth on top of it.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|replace|merge|copy)\b/i;

export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) return false; // no multiple statements
  if (!/^\s*(select|with)\b/i.test(trimmed)) return false;
  if (FORBIDDEN.test(trimmed)) return false;
  return true;
}

export function assertReadOnly(sql: string): void {
  if (!isReadOnlyQuery(sql)) {
    throw new Error("Only a single read-only SELECT/WITH query is allowed.");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/sql-guard.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/sql-guard.ts scripts/solutions-db/__tests__/sql-guard.test.ts
git commit -m "feat(solutions-db): read-only SQL guard for the sql MCP tool"
```

---

### Task 6: `lib/embeddings.ts` — embedding text, truncation, chunked batch (lazy client)

**Files:**

- Create: `scripts/solutions-db/lib/embeddings.ts`
- Test: `scripts/solutions-db/__tests__/embeddings.test.ts`

**Note:** the OpenAI client is built **lazily** so importing this module during `vitest run` never requires an API key. `embedBatch` takes an injectable client for testability and chunks at 100 inputs/request (≈100K tokens, under the ~300K/request ceiling); each text is truncated to ~32K chars (~8K tokens, under the 8191 per-input limit).

- [ ] **Step 1: Write failing tests**

```ts
// scripts/solutions-db/__tests__/embeddings.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  buildEmbeddingText,
  truncateForEmbedding,
  embedBatch,
  MAX_EMBED_CHARS,
  EMBED_INPUT_CHUNK,
} from "../lib/embeddings";

describe("buildEmbeddingText", () => {
  it("joins title and body", () => {
    expect(buildEmbeddingText("Title", "Body")).toBe("Title\n\nBody");
  });
});

describe("truncateForEmbedding", () => {
  it("caps length at MAX_EMBED_CHARS", () => {
    expect(truncateForEmbedding("a".repeat(MAX_EMBED_CHARS + 500)).length).toBe(
      MAX_EMBED_CHARS,
    );
  });
});

describe("embedBatch", () => {
  it("chunks inputs and flattens vectors in order", async () => {
    const total = EMBED_INPUT_CHUNK + 5;
    const calls: number[] = [];
    const fakeClient = {
      embeddings: {
        create: vi.fn(async ({ input }: { input: string[] }) => {
          calls.push(input.length);
          return {
            data: input.map((_, i) => ({ embedding: [input.length, i] })),
          };
        }),
      },
    } as any;
    const texts = Array.from({ length: total }, (_, i) => `t${i}`);
    const vecs = await embedBatch(texts, fakeClient);
    expect(vecs).toHaveLength(total);
    expect(calls).toEqual([EMBED_INPUT_CHUNK, 5]); // two requests
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/solutions-db/__tests__/embeddings.test.ts`
Expected: FAIL with "Cannot find module '../lib/embeddings'".

- [ ] **Step 3: Implement `lib/embeddings.ts`**

```ts
// scripts/solutions-db/lib/embeddings.ts
import OpenAI from "openai";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;
export const MAX_EMBED_CHARS = 32_000; // ~8K tokens, under the 8191 per-input cap
export const EMBED_INPUT_CHUNK = 100; // ~100K tokens/request, under the ~300K cap

let _client: OpenAI | null = null;
export function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) throw new Error("AI_INTEGRATIONS_OPENAI_API_KEY not set");
    _client = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _client;
}

export function buildEmbeddingText(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

export function truncateForEmbedding(text: string): string {
  return text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
}

/** Embed `texts` in order. Pass a client for tests; defaults to the lazy singleton. */
export async function embedBatch(
  texts: string[],
  client: Pick<OpenAI, "embeddings"> = getClient(),
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_INPUT_CHUNK) {
    const chunk = texts
      .slice(i, i + EMBED_INPUT_CHUNK)
      .map(truncateForEmbedding);
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: chunk,
    });
    for (const d of res.data) out.push(d.embedding as number[]);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/embeddings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/embeddings.ts scripts/solutions-db/__tests__/embeddings.test.ts
git commit -m "feat(solutions-db): lazy OpenAI embeddings client with chunked batching"
```

---

### Task 7: `schema.sql` + `lib/db.ts` — database layer (real-DB verification)

**Files:**

- Create: `scripts/solutions-db/schema.sql`
- Create: `scripts/solutions-db/lib/db.ts`

- [ ] **Step 1: Write `scripts/solutions-db/schema.sql`**

```sql
-- scripts/solutions-db/schema.sql
-- Run as a Postgres SUPERUSER (CREATE EXTENSION / CREATE ROLE require it):
--   createdb ocrecipes_solutions   # one-time
--   npm run solutions:db:init
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN CREATE TYPE track_enum AS ENUM ('bug','knowledge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE category_enum AS ENUM
  ('logic-errors','runtime-errors','code-quality','performance-issues',
   'conventions','design-patterns','best-practices');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS solutions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path     text UNIQUE NOT NULL,
  slug            text NOT NULL,
  title           text NOT NULL,
  track           track_enum NOT NULL,
  category        category_enum NOT NULL,
  module          text,
  severity        text,
  tags            text[] NOT NULL DEFAULT '{}',
  symptoms        text[] NOT NULL DEFAULT '{}',
  applies_to      text[] NOT NULL DEFAULT '{}',
  created         date NOT NULL,
  last_updated    date,
  body            text NOT NULL,
  sections        jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash    text NOT NULL,
  embedding       vector(1536),
  embedding_model text,
  tsv             tsvector GENERATED ALWAYS AS
                    (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) STORED,
  warnings        text[] NOT NULL DEFAULT '{}',
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solutions_embedding_hnsw ON solutions USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS solutions_tsv_gin       ON solutions USING gin (tsv);
CREATE INDEX IF NOT EXISTS solutions_tags_gin      ON solutions USING gin (tags);
CREATE INDEX IF NOT EXISTS solutions_symptoms_gin  ON solutions USING gin (symptoms);
CREATE INDEX IF NOT EXISTS solutions_title_trgm    ON solutions USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS solutions_track_idx     ON solutions (track);
CREATE INDEX IF NOT EXISTS solutions_category_idx  ON solutions (category);
CREATE INDEX IF NOT EXISTS solutions_module_idx    ON solutions (module);
CREATE INDEX IF NOT EXISTS solutions_created_idx   ON solutions (created);

-- Read-only role for the MCP server (idempotent).
DO $$ BEGIN CREATE ROLE solutions_ro LOGIN PASSWORD 'solutions_ro';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT CONNECT ON DATABASE ocrecipes_solutions TO solutions_ro;
GRANT USAGE ON SCHEMA public TO solutions_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO solutions_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO solutions_ro;
```

- [ ] **Step 2: Implement `lib/db.ts`**

```ts
// scripts/solutions-db/lib/db.ts
import { Pool } from "pg";

/** Lazy factory — never call at module top level (would connect at import). */
export function createPool(connectionString: string | undefined): Pool {
  if (!connectionString) throw new Error("connection string is required");
  return new Pool({ connectionString });
}

/** pgvector accepts a bracketed literal; cast the bound param with `::vector`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
```

- [ ] **Step 3: Create the database and apply the schema**

```bash
createdb ocrecipes_solutions
export SOLUTIONS_DATABASE_URL="postgresql://localhost/ocrecipes_solutions"
npm run solutions:db:init
```

Expected: no errors; `CREATE EXTENSION`/`CREATE TABLE`/`CREATE INDEX`/`GRANT` notices.

- [ ] **Step 4: Verify the schema applied**

Run: `psql "$SOLUTIONS_DATABASE_URL" -c "\d solutions" -c "\du solutions_ro"`
Expected: the `solutions` table with an `embedding` column of type `vector(1536)`, and role `solutions_ro` listed.

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/schema.sql scripts/solutions-db/lib/db.ts
git commit -m "feat(solutions-db): schema.sql (pgvector + ro role) and lazy pg pool factory"
```

---

### Task 8: `ingest.ts` — walk → parse → embed-on-change → upsert (real-DB)

**Files:**

- Create: `scripts/solutions-db/ingest.ts`

- [ ] **Step 1: Implement `ingest.ts`**

```ts
// scripts/solutions-db/ingest.ts
/**
 * Ingest docs/solutions/ markdown into ocrecipes_solutions (idempotent).
 * Usage: tsx scripts/solutions-db/ingest.ts [--prune]
 * Requires: SOLUTIONS_DATABASE_URL (owner/write), AI_INTEGRATIONS_OPENAI_API_KEY.
 */
import "dotenv/config";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createPool, toVectorLiteral } from "./lib/db";
import { parseSolution, type ParsedSolution } from "./lib/parse";
import { buildEmbeddingText, embedBatch, EMBED_MODEL } from "./lib/embeddings";

const REPO_ROOT = join(__dirname, "..", "..");
const SOLUTIONS_ROOT = join(REPO_ROOT, "docs", "solutions");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_manifests") continue;
      out.push(...walk(join(dir, entry.name)));
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function parseFile(absPath: string): ParsedSolution {
  const raw = readFileSync(absPath, "utf8");
  const mtimeISO = statSync(absPath).mtime.toISOString().slice(0, 10);
  return parseSolution(raw, relative(SOLUTIONS_ROOT, absPath), mtimeISO);
}

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);
  const parsed = walk(SOLUTIONS_ROOT).map(parseFile);

  const existing = new Map<
    string,
    { content_hash: string; has_embedding: boolean }
  >();
  for (const r of (
    await pool.query(
      "SELECT source_path, content_hash, (embedding IS NOT NULL) AS has_embedding FROM solutions",
    )
  ).rows) {
    existing.set(r.source_path, {
      content_hash: r.content_hash,
      has_embedding: r.has_embedding,
    });
  }

  const needEmbed = parsed.filter((p) => {
    const e = existing.get(p.sourcePath);
    return !e || e.content_hash !== p.contentHash || !e.has_embedding;
  });
  const vectors = needEmbed.length
    ? await embedBatch(
        needEmbed.map((p) => buildEmbeddingText(p.title, p.body)),
      )
    : [];
  const embByPath = new Map<string, number[]>();
  needEmbed.forEach((p, i) => embByPath.set(p.sourcePath, vectors[i]));

  for (const p of parsed) {
    await pool.query(
      `INSERT INTO solutions
         (source_path, slug, title, track, category, module, severity, tags, symptoms,
          applies_to, created, last_updated, body, sections, content_hash, warnings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
       ON CONFLICT (source_path) DO UPDATE SET
         slug=EXCLUDED.slug, title=EXCLUDED.title, track=EXCLUDED.track, category=EXCLUDED.category,
         module=EXCLUDED.module, severity=EXCLUDED.severity, tags=EXCLUDED.tags, symptoms=EXCLUDED.symptoms,
         applies_to=EXCLUDED.applies_to, created=EXCLUDED.created, last_updated=EXCLUDED.last_updated,
         body=EXCLUDED.body, sections=EXCLUDED.sections, content_hash=EXCLUDED.content_hash,
         warnings=EXCLUDED.warnings, ingested_at=now()`,
      [
        p.sourcePath,
        p.slug,
        p.title,
        p.track,
        p.category,
        p.module,
        p.severity,
        p.tags,
        p.symptoms,
        p.appliesTo,
        p.created,
        p.lastUpdated,
        p.body,
        JSON.stringify(p.sections),
        p.contentHash,
        p.warnings,
      ],
    );
  }
  for (const [path, vec] of embByPath) {
    await pool.query(
      "UPDATE solutions SET embedding=$1::vector, embedding_model=$2 WHERE source_path=$3",
      [toVectorLiteral(vec), EMBED_MODEL, path],
    );
  }
  if (process.argv.includes("--prune")) {
    const keep = parsed.map((p) => p.sourcePath);
    const del = await pool.query(
      "DELETE FROM solutions WHERE source_path <> ALL($1) RETURNING source_path",
      [keep],
    );
    console.log(`Pruned ${del.rowCount} rows with no source file.`);
  }
  const warned = parsed.filter((p) => p.warnings.length).length;
  console.log(
    `Ingested ${parsed.length} files; embedded ${embByPath.size}; ${warned} files had warnings.`,
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the ingest and verify the row count**

```bash
export SOLUTIONS_DATABASE_URL="postgresql://localhost/ocrecipes_solutions"
npm run solutions:db:ingest
psql "$SOLUTIONS_DATABASE_URL" -c "SELECT count(*) AS rows, count(embedding) AS embedded FROM solutions"
```

Expected: `rows = 487` and `embedded = 487` (first line of output prints "Ingested 487 files; embedded 487; ...").

- [ ] **Step 3: Verify idempotent re-run does no re-embedding**

Run: `npm run solutions:db:ingest`
Expected: output reads "Ingested 487 files; embedded 0; ..." (content unchanged → no re-embed).

- [ ] **Step 4: Commit**

```bash
git add scripts/solutions-db/ingest.ts
git commit -m "feat(solutions-db): idempotent markdown ingestion with embed-on-change"
```

---

### Task 9: `dedup-report.ts` — exact + near clusters → manifest (real-DB)

**Files:**

- Create: `scripts/solutions-db/dedup-report.ts`

- [ ] **Step 1: Implement `dedup-report.ts`**

```ts
// scripts/solutions-db/dedup-report.ts
/**
 * Non-destructive dedup report. Usage: tsx scripts/solutions-db/dedup-report.ts [--threshold=0.88]
 * Writes docs/solutions/_manifests/<YYYY-MM-DD>-dedup-report.md
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "./lib/db";
import { clusterByPairs } from "./lib/dedup";

const REPO_ROOT = join(__dirname, "..", "..");

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
  const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.88;
  const pool = createPool(url);

  const exact = (
    await pool.query(
      "SELECT array_agg(source_path ORDER BY source_path) AS paths FROM solutions GROUP BY content_hash HAVING count(*) > 1",
    )
  ).rows;

  const pairRows = (
    await pool.query(
      `SELECT a.source_path AS a, b.source_path AS b, 1 - (a.embedding <=> b.embedding) AS sim
       FROM solutions a JOIN solutions b ON a.id < b.id
      WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) < $1
      ORDER BY sim DESC`,
      [1 - threshold],
    )
  ).rows as { a: string; b: string; sim: number }[];

  const simByPair = new Map(
    pairRows.map((p) => [`${p.a}|${p.b}`, Number(p.sim)]),
  );
  const clusters = clusterByPairs(
    pairRows.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim) })),
  );

  const date = new Date().toISOString().slice(0, 10);
  let md = `# Dedup report — ${date}\n\nThreshold: cosine ≥ ${threshold}. Non-destructive: nothing was merged.\n\n`;
  md += `## Exact duplicates (identical content hash)\n\n`;
  md += exact.length
    ? exact.map((e) => `- ${e.paths.join("\n  - ")}`).join("\n") + "\n"
    : "_none_\n";
  md += `\n## Near-duplicate clusters (${clusters.length})\n\n`;
  for (const cluster of clusters) {
    md += `### Cluster (${cluster.length})\n`;
    for (const path of cluster) md += `- ${path}\n`;
    const sims = cluster.flatMap((a, i) =>
      cluster
        .slice(i + 1)
        .map((b) => simByPair.get(`${a}|${b}`) ?? simByPair.get(`${b}|${a}`))
        .filter((s): s is number => s !== undefined),
    );
    if (sims.length)
      md += `_pairwise similarity: ${Math.min(...sims).toFixed(3)}–${Math.max(...sims).toFixed(3)}_\n`;
    md += `_suggested action: review for merge / keep-distinct / add \`## See Also\` link_\n\n`;
  }

  const outPath = join(
    REPO_ROOT,
    "docs",
    "solutions",
    "_manifests",
    `${date}-dedup-report.md`,
  );
  writeFileSync(outPath, md, "utf8");
  console.log(
    `Wrote ${outPath}: ${exact.length} exact groups, ${clusters.length} near clusters.`,
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the report and verify it wrote**

```bash
export SOLUTIONS_DATABASE_URL="postgresql://localhost/ocrecipes_solutions"
npm run solutions:db:dedup
ls -la docs/solutions/_manifests/$(date +%F)-dedup-report.md
```

Expected: the report file exists; stdout prints the exact/near counts.

- [ ] **Step 3: Sanity-check the report content**

Run: `head -40 docs/solutions/_manifests/$(date +%F)-dedup-report.md`
Expected: a "Dedup report" header, an Exact-duplicates section, and zero or more near-duplicate clusters with similarity ranges.

- [ ] **Step 4: Commit (code only — the report lives in gitignored docs/solutions)**

```bash
git add scripts/solutions-db/dedup-report.ts
git commit -m "feat(solutions-db): non-destructive dedup report generator"
```

---

### Task 10: `mcp-server.ts` — 7 read-only MCP tools (verified SDK API)

**Files:**

- Create: `scripts/solutions-db/mcp-server.ts`

**SDK API (verified against `@modelcontextprotocol/sdk` v1.29.0):** `new McpServer({name,version})`; `server.registerTool(name, {description, inputSchema:{<zod shape>}}, async (args)=>({content:[{type:"text",text}]}))`; `await server.connect(new StdioServerTransport())`. **stdout is the JSON-RPC channel — log only with `console.error`.**

- [ ] **Step 1: Confirm the installed SDK exposes `registerTool` (guards against a version drift)**

Run: `node -e "const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js'); console.log(typeof McpServer.prototype.registerTool)"`
Expected: `function`. (If `undefined`, the installed SDK is older/newer than v1.29.0 — check its `docs/server.md` for the tool-registration signature before continuing.)

- [ ] **Step 2: Implement `mcp-server.ts`**

```ts
// scripts/solutions-db/mcp-server.ts
/**
 * Read-only MCP server over ocrecipes_solutions.
 * Launched via .mcp.json. Requires SOLUTIONS_DB_READONLY_URL + AI_INTEGRATIONS_OPENAI_API_KEY.
 * NOTE: stdout is the JSON-RPC transport — log ONLY with console.error.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPool, toVectorLiteral } from "./lib/db";
import { embedBatch } from "./lib/embeddings";
import { isReadOnlyQuery } from "./lib/sql-guard";
import { matchesAnyGlob } from "./lib/globs";

const pool = createPool(process.env.SOLUTIONS_DB_READONLY_URL);
const server = new McpServer({ name: "solutions-db", version: "1.0.0" });

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});
async function embedQuery(q: string): Promise<number[]> {
  const [v] = await embedBatch([q]);
  return v;
}

server.registerTool(
  "search_solutions",
  {
    description: "Semantic search over solutions; optional structured filters.",
    inputSchema: {
      query: z.string(),
      k: z.number().int().positive().max(50).default(8),
      track: z.enum(["bug", "knowledge"]).optional(),
      category: z.string().optional(),
      module: z.string().optional(),
      tags: z.array(z.string()).optional(),
      severity: z.string().optional(),
    },
  },
  async (args) => {
    const vec = await embedQuery(args.query);
    const where = ["embedding IS NOT NULL"];
    const params: unknown[] = [toVectorLiteral(vec)];
    let i = 2;
    if (args.track) {
      where.push(`track = $${i++}`);
      params.push(args.track);
    }
    if (args.category) {
      where.push(`category = $${i++}`);
      params.push(args.category);
    }
    if (args.module) {
      where.push(`module = $${i++}`);
      params.push(args.module);
    }
    if (args.severity) {
      where.push(`severity = $${i++}`);
      params.push(args.severity);
    }
    if (args.tags?.length) {
      where.push(`tags && $${i++}`);
      params.push(args.tags);
    }
    const kIdx = i;
    params.push(args.k);
    const r = await pool.query(
      `SELECT source_path, slug, title, category, track,
            1 - (embedding <=> $1::vector) AS similarity, left(body, 300) AS snippet
       FROM solutions WHERE ${where.join(" AND ")}
       ORDER BY embedding <=> $1::vector LIMIT $${kIdx}`,
      params,
    );
    return text(r.rows);
  },
);

server.registerTool(
  "get_solution",
  {
    description: "Fetch a full solution by slug or source_path.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const r = await pool.query(
      "SELECT * FROM solutions WHERE source_path = $1 OR slug = $1 ORDER BY created DESC",
      [id],
    );
    return text(r.rows);
  },
);

server.registerTool(
  "related_solutions",
  {
    description: "Nearest semantic neighbours of an existing solution.",
    inputSchema: {
      slug: z.string(),
      k: z.number().int().positive().max(50).default(5),
    },
  },
  async ({ slug, k }) => {
    const r = await pool.query(
      `SELECT b.source_path, b.title, b.category, 1 - (a.embedding <=> b.embedding) AS similarity
       FROM solutions a JOIN solutions b ON b.id <> a.id
      WHERE (a.source_path = $1 OR a.slug = $1) AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
      ORDER BY a.embedding <=> b.embedding LIMIT $2`,
      [slug, k],
    );
    return text(r.rows);
  },
);

server.registerTool(
  "find_by_applies_to",
  {
    description:
      "Solutions whose applies_to globs match a repo-relative file path (previews the inject hook).",
    inputSchema: { file_path: z.string() },
  },
  async ({ file_path }) => {
    const r = await pool.query(
      "SELECT source_path, title, applies_to, created FROM solutions WHERE cardinality(applies_to) > 0 ORDER BY created DESC",
    );
    return text(
      r.rows.filter((row) => matchesAnyGlob(file_path, row.applies_to)),
    );
  },
);

server.registerTool(
  "find_duplicates",
  {
    description: "Near-duplicate pairs above a cosine threshold.",
    inputSchema: {
      threshold: z.number().min(0).max(1).default(0.88),
      category: z.string().optional(),
    },
  },
  async ({ threshold, category }) => {
    const params: unknown[] = [1 - threshold];
    let catClause = "";
    if (category) {
      catClause = "AND a.category = $2 AND b.category = $2";
      params.push(category);
    }
    const r = await pool.query(
      `SELECT a.source_path AS a, b.source_path AS b, 1 - (a.embedding <=> b.embedding) AS sim
       FROM solutions a JOIN solutions b ON a.id < b.id
      WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) < $1 ${catClause}
      ORDER BY sim DESC LIMIT 200`,
      params,
    );
    return text(r.rows);
  },
);

server.registerTool(
  "stats",
  {
    description: "Corpus overview counts.",
    inputSchema: {},
  },
  async () => {
    const totals = (
      await pool.query(
        `SELECT count(*)::int AS total,
            count(embedding)::int AS embedded,
            count(*) FILTER (WHERE cardinality(warnings) > 0)::int AS with_warnings,
            min(created) AS oldest, max(created) AS newest
       FROM solutions`,
      )
    ).rows[0];
    const byCategory = (
      await pool.query(
        "SELECT category, count(*)::int AS n FROM solutions GROUP BY category ORDER BY category",
      )
    ).rows;
    const byTrack = (
      await pool.query(
        "SELECT track, count(*)::int AS n FROM solutions GROUP BY track",
      )
    ).rows;
    const bySeverity = (
      await pool.query(
        "SELECT severity, count(*)::int AS n FROM solutions GROUP BY severity ORDER BY n DESC",
      )
    ).rows;
    return text({ ...totals, byCategory, byTrack, bySeverity });
  },
);

server.registerTool(
  "sql",
  {
    description: "Run a single read-only SELECT/WITH query.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    if (!isReadOnlyQuery(query)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Rejected: only a single read-only SELECT/WITH query is allowed.",
          },
        ],
        isError: true,
      };
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const r = await client.query(query);
      await client.query("ROLLBACK");
      return text(r.rows.slice(0, 200));
    } finally {
      client.release();
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("solutions-db MCP server connected (stdio).");
```

- [ ] **Step 3: Smoke-test the server starts and lists tools over stdio**

Run:

```bash
export SOLUTIONS_DB_READONLY_URL="postgresql://solutions_ro:solutions_ro@localhost/ocrecipes_solutions"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx tsx scripts/solutions-db/mcp-server.ts
```

Expected: a JSON-RPC response on stdout listing the 7 tool names (`search_solutions`, `get_solution`, `related_solutions`, `find_by_applies_to`, `find_duplicates`, `stats`, `sql`); the "connected" line appears on stderr. (Process stays open on stdio — Ctrl-C to exit.)

- [ ] **Step 4: Commit**

```bash
git add scripts/solutions-db/mcp-server.ts
git commit -m "feat(solutions-db): read-only MCP server with 7 search/inspect tools"
```

---

### Task 11: `integration-check.ts` + `.mcp.json` — final wiring (real-DB)

**Files:**

- Create: `scripts/solutions-db/integration-check.ts`
- Create: `.mcp.json`

- [ ] **Step 1: Implement `integration-check.ts`**

```ts
// scripts/solutions-db/integration-check.ts
/**
 * Standalone integration check (NOT a vitest test — avoids import-time DB connect in CI).
 * Usage: tsx scripts/solutions-db/integration-check.ts
 * Requires SOLUTIONS_DATABASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY.
 */
import "dotenv/config";
import { createPool, toVectorLiteral } from "./lib/db";
import { embedBatch } from "./lib/embeddings";

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("FAIL: SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);

  const {
    rows: [counts],
  } = await pool.query(
    "SELECT count(*) AS total, count(embedding) AS embedded FROM solutions",
  );
  if (Number(counts.total) === 0) {
    console.error("FAIL: solutions table is empty — run solutions:db:ingest");
    process.exit(1);
  }
  console.log(`OK: ${counts.total} rows, ${counts.embedded} embedded.`);

  const [vec] = await embedBatch([
    "array index returns undefined on negative index",
  ]);
  const { rows } = await pool.query(
    `SELECT source_path, 1 - (embedding <=> $1::vector) AS similarity
       FROM solutions WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 3`,
    [toVectorLiteral(vec)],
  );
  if (rows.length === 0) {
    console.error("FAIL: semantic search returned no rows");
    process.exit(1);
  }
  if (typeof rows[0].similarity !== "number") {
    console.error("FAIL: missing similarity score");
    process.exit(1);
  }
  console.log(
    `OK: top match ${rows[0].source_path} (sim ${Number(rows[0].similarity).toFixed(3)}).`,
  );

  await pool.end();
  console.log("Integration check PASSED.");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the integration check**

```bash
export SOLUTIONS_DATABASE_URL="postgresql://localhost/ocrecipes_solutions"
npm run solutions:db:check
```

Expected: three `OK:` lines then "Integration check PASSED."; exit code 0 (`echo $?`).

- [ ] **Step 3: Create `.mcp.json` (committed; no secrets — `${VAR}` interpolation)**

```json
{
  "mcpServers": {
    "solutions-db": {
      "command": "npx",
      "args": ["tsx", "scripts/solutions-db/mcp-server.ts"],
      "env": {
        "SOLUTIONS_DB_READONLY_URL": "${SOLUTIONS_DB_READONLY_URL}",
        "AI_INTEGRATIONS_OPENAI_API_KEY": "${AI_INTEGRATIONS_OPENAI_API_KEY}",
        "AI_INTEGRATIONS_OPENAI_BASE_URL": "${AI_INTEGRATIONS_OPENAI_BASE_URL}"
      }
    }
  }
}
```

Then add the actual values to your shell env (e.g. `~/.zshenv`), so interpolation resolves:

```bash
export SOLUTIONS_DB_READONLY_URL="postgresql://solutions_ro:solutions_ro@localhost/ocrecipes_solutions"
```

- [ ] **Step 4: Verify the run-time gates (CI-safe unit tests still green without DB/key)**

Run: `npx vitest run scripts/solutions-db/__tests__/`
Expected: all unit suites PASS with no `SOLUTIONS_DATABASE_URL` and no API key set (confirms nothing connects at import).

- [ ] **Step 5: Commit and push the branch**

```bash
git add .mcp.json scripts/solutions-db/integration-check.ts
git commit -m "feat(solutions-db): integration check script and committed MCP wiring"
git push -u origin feat/solutions-db-sp1
```

- [ ] **Step 6: Restart Claude Code to load the new MCP server, then sanity-check**

After restart, confirm the `solutions-db` MCP tools are available and `search_solutions` returns relevant results for a natural-language query.

---

## Self-Review

**Spec coverage (all SP1 acceptance criteria mapped):**

- DB + `vector`/`pg_trgm` + schema via `solutions:db:init` → Task 7.
- Idempotent load of 487 files; cheap re-run → Task 8 (Steps 2–3).
- Every row valid `track`/`category` + embedding-or-reason, warnings surfaced → Task 2 (derivation/warnings) + Task 8.
- Dated dedup report under `_manifests/` → Task 9.
- 7 MCP tools; `search_solutions` relevant; `sql` rejects writes → Task 10 + Task 5.
- Unit tests pass in CI without DB/key; integration behind standalone script → Tasks 2–6 (pure, mocked) + Task 11 Step 4 + Task 11 (`solutions:db:check`).
- 487 content files unchanged (only `_manifests/` report added) → no task writes under the category dirs; Task 9 writes only to `_manifests/`.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the `stats` tool includes a concrete fallback note, not a placeholder.

**Type consistency:** `ParsedSolution` field names (`sourcePath`, `appliesTo`, `contentHash`, `lastUpdated`) are used identically in Task 2 (definition) and Task 8 (consumer). `embedBatch(texts, client?)`, `toVectorLiteral`, `createPool`, `isReadOnlyQuery`, `matchesAnyGlob`, `clusterByPairs(SimPair[])` signatures match across defining and consuming tasks. SQL placeholder indexing in `search_solutions` uses a single running `i` with `$1` reserved for the vector.

**Out of scope (SP2, not in this plan):** rewriting `inject-patterns.sh`/`/codify` to use the DB, updating agent path references, deleting the markdown files, any write-path tools.
