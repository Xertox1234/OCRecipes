# Solutions Database SP2 (Enforcement Cut-over) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ocrecipes_solutions` the canonical store for the `docs/solutions/` knowledge base — the injection hook reads from it, `/codify` writes to it, and the 491 markdown files become a regenerated read-only mirror — with no irreversible step.

**Architecture:** Extend the existing `scripts/solutions-db/` module. Redefine `content_hash` from a raw-bytes hash to a serialization-independent _normalized-projection_ hash and add an `extra_fields jsonb` column so a regenerated mirror round-trips. Add three CLIs (`export`, `add`, `parity`) and rewire `inject-patterns.sh` to query the DB via `psql` with a markdown-mirror fallback gated by `PATTERN_INJECT_SOURCE`. Cut over in a reversible order behind three gates (parity → round-trip → hook-equivalence).

**Tech Stack:** TypeScript + `tsx`, PostgreSQL 18 (`pgvector`, `pg_trgm`), `pg`, `gray-matter`, `zod`, OpenAI `text-embedding-3-small`, Vitest, Bash (the hook).

**Spec:** `docs/superpowers/specs/2026-06-13-solutions-database-sp2-enforcement-cutover-design.md`

---

## File Structure

**New files:**

- `scripts/solutions-db/lib/files.ts` — `listSolutionFiles()` + `parseFile()` walk/parse helpers (extracted from `ingest.ts` for reuse).
- `scripts/solutions-db/lib/upsert.ts` — `upsertSolutions(pool, parsed[])`: needEmbed → embed → upsert (extracted from `ingest.ts`; now writes `extra_fields`).
- `scripts/solutions-db/lib/serialize.ts` — `serializeSolution(projection)`: pure DB-row → canonical markdown (inverse of parse).
- `scripts/solutions-db/lib/parity.ts` — `compareParity(diskHashes, dbRows)`: pure DB==disk comparison.
- `scripts/solutions-db/export.ts` — CLI: regenerate one file / `--all`, and `--verify` (in-memory full-corpus round-trip = Gate B).
- `scripts/solutions-db/add.ts` — CLI: single-file write path (near-dup check → upsert → export).
- `scripts/solutions-db/parity-check.ts` — CLI: Gate A (count + per-file hash + NULL-embedding check).
- `scripts/solutions-db/hook-equivalence-check.ts` — CLI: Gate C (run the bash hook db-vs-markdown across all domains, diff).
- Tests: `scripts/solutions-db/__tests__/projection.test.ts`, `serialize.test.ts`, `parity.test.ts`.

**Modified files:**

- `scripts/solutions-db/lib/parse.ts` — add `extraFields`; redefine `computeContentHash`; add `canonicalProjection` + `ProjectionInput`; variant normalization.
- `scripts/solutions-db/__tests__/parse.test.ts` — add variant-normalization + extra_fields cases.
- `scripts/solutions-db/schema.sql` — add `extra_fields jsonb`.
- `scripts/solutions-db/ingest.ts` — use `lib/files.ts` + `lib/upsert.ts`.
- `.claude/hooks/inject-patterns.sh` — solution-ref block: `solutions_from_db` / `solutions_from_markdown` / dispatcher.
- `package.json` — `solutions:db:export`, `:add`, `:parity` scripts.
- `.claude/skills/codify/SKILL.md`, `audit/SKILL.md`, `todo/SKILL.md` — route writes through `solutions:db:add`.
- 11 `.claude/agents/*.md` + `docs/PATTERNS.md`, `CLAUDE.md`, `docs/AI_DRIFT_CHECKLIST.md`, `docs/DEV_SETUP.md` — prose redirect to DB/MCP.

**Branch:** create `feat/solutions-db-sp2` off `main` before Task 1.

```bash
git switch -c feat/solutions-db-sp2
```

---

### Task 1: Add `extra_fields` column to the schema

**Files:**

- Modify: `scripts/solutions-db/schema.sql`

- [ ] **Step 1: Add the column to the CREATE TABLE and an idempotent ALTER**

In `scripts/solutions-db/schema.sql`, add `extra_fields` to the `CREATE TABLE` (after the `warnings` line, before `ingested_at`):

```sql
  warnings        text[] NOT NULL DEFAULT '{}',
  extra_fields    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now()
```

And add this idempotent migration immediately after the `CREATE TABLE ( … );` block (so re-running `:init` adds the column to the already-existing DB, where `CREATE TABLE IF NOT EXISTS` is a no-op):

```sql
-- SP2: ensure extra_fields exists on a pre-SP2 table (no-op on a fresh CREATE above).
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: Apply it and verify the column exists**

Run:

```bash
npm run solutions:db:init
psql "$SOLUTIONS_DATABASE_URL" -c "\d solutions" | grep extra_fields
```

Expected: a line showing `extra_fields | jsonb | not null` (default `'{}'::jsonb`). The 487 existing rows now have `extra_fields = {}`.

- [ ] **Step 3: Commit**

```bash
git add scripts/solutions-db/schema.sql
git commit -m "feat(solutions-db): add extra_fields jsonb column (SP2)"
```

---

### Task 2: Redefine `content_hash` as a normalized-projection hash

**Files:**

- Modify: `scripts/solutions-db/lib/parse.ts`
- Test: `scripts/solutions-db/__tests__/projection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/solutions-db/__tests__/projection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/solutions-db/__tests__/projection.test.ts`
Expected: FAIL — `canonicalProjection`/`ProjectionInput` are not exported yet.

- [ ] **Step 3: Implement the projection and redefine the hash**

In `scripts/solutions-db/lib/parse.ts`, add the exported `ProjectionInput` interface and functions (place near the top, after the `Category` type), and **replace** the existing `computeContentHash`:

```ts
export interface ProjectionInput {
  title: string;
  track: Track;
  category: Category;
  module: string | null;
  severity: string | null;
  tags: string[];
  symptoms: string[];
  appliesTo: string[];
  created: string;
  lastUpdated: string | null;
  extraFields: Record<string, unknown>;
  body: string;
}

function sortedKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

/** Deterministic, serialization-independent projection. Hash this, not the raw bytes. */
export function canonicalProjection(p: ProjectionInput): string {
  const fields = {
    title: p.title,
    track: p.track,
    category: p.category,
    module: p.module ?? null,
    severity: p.severity ?? null,
    tags: p.tags,
    symptoms: p.symptoms,
    applies_to: p.appliesTo,
    created: p.created,
    last_updated: p.lastUpdated ?? null,
    extra: sortedKeys(p.extraFields),
  };
  return JSON.stringify(fields) + "\n" + p.body.trim();
}

export function computeContentHash(p: ProjectionInput): string {
  return createHash("sha256").update(canonicalProjection(p)).digest("hex");
}
```

Delete the old `export function computeContentHash(raw: string)` (lines 99–101).

- [ ] **Step 4: Wire `parseSolution` to the new hash (interim — extras come in Task 3)**

In `parseSolution`, replace the return-object's `contentHash: computeContentHash(raw)` with a projection built from the values already computed. Add `extraFields: {}` for now (Task 3 fills it) and add `extraFields` to the returned object:

```ts
const projection: ProjectionInput = {
  title,
  track,
  category,
  module: moduleName,
  severity,
  tags,
  symptoms: data.symptoms ?? [],
  appliesTo: data.applies_to ?? [],
  created,
  lastUpdated: toISODate(data.last_updated),
  extraFields: {},
  body: content.trim(),
};

return {
  sourcePath,
  slug,
  title,
  track,
  category,
  module: moduleName,
  severity,
  tags,
  symptoms: data.symptoms ?? [],
  appliesTo: data.applies_to ?? [],
  created,
  lastUpdated: toISODate(data.last_updated),
  body: content.trim(),
  sections: splitSections(content),
  contentHash: computeContentHash(projection),
  extraFields: {},
  warnings,
};
```

Add `extraFields: Record<string, unknown>;` to the `ParsedSolution` interface.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/projection.test.ts scripts/solutions-db/__tests__/parse.test.ts`
Expected: PASS (the existing `parse.test.ts` hash assertion only checks the hex format, which still holds).

- [ ] **Step 6: Commit**

```bash
git add scripts/solutions-db/lib/parse.ts scripts/solutions-db/__tests__/projection.test.ts
git commit -m "feat(solutions-db): normalized-projection content_hash (SP2)"
```

---

### Task 3: Variant-key normalization + `extra_fields` routing in `parseSolution`

**Files:**

- Modify: `scripts/solutions-db/lib/parse.ts`
- Test: `scripts/solutions-db/__tests__/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/solutions-db/__tests__/parse.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/solutions-db/__tests__/parse.test.ts`
Expected: FAIL — `extraFields` is `{}` and `date`/`updated` are ignored.

- [ ] **Step 3: Implement normalization**

In `parseSolution`, add a `Record<string, unknown>` view and a date coercer, and compute `extraFields` + variant-normalized `created`/`lastUpdated`. Add near the other helpers (module scope):

```ts
function asDateish(v: unknown): string | Date | undefined {
  return typeof v === "string" || v instanceof Date ? v : undefined;
}

const KNOWN_FM_KEYS = new Set([
  "title",
  "track",
  "category",
  "module",
  "severity",
  "tags",
  "symptoms",
  "applies_to",
  "created",
  "last_updated",
]);
const VARIANT_FM_KEYS = new Set(["date", "updated"]);
```

Inside `parseSolution`, replace the `created` derivation block:

```ts
const fm = data as Record<string, unknown>;

const createdFromFm = toISODate(data.created) ?? toISODate(asDateish(fm.date));
const created = createdFromFm ?? dateFromFileName(fileName) ?? mtimeISO;
if (!toISODate(data.created) && toISODate(asDateish(fm.date))) {
  warnings.push("created derived from `date:` variant key");
} else if (!createdFromFm) {
  warnings.push("created missing — derived from filename/mtime");
}

const lastUpdated =
  toISODate(data.last_updated) ?? toISODate(asDateish(fm.updated));
if (!toISODate(data.last_updated) && toISODate(asDateish(fm.updated))) {
  warnings.push("last_updated derived from `updated:` variant key");
}

const extraFields: Record<string, unknown> = {};
for (const [k, v] of Object.entries(fm)) {
  if (v === undefined) continue;
  if (KNOWN_FM_KEYS.has(k) || VARIANT_FM_KEYS.has(k)) continue;
  extraFields[k] = v;
}
```

Then set `extraFields` in BOTH the `projection` object and the returned object (replace the two `extraFields: {}` placeholders from Task 2 with `extraFields`), and replace `lastUpdated: toISODate(data.last_updated)` in both with `lastUpdated`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/solutions-db/__tests__/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/parse.ts scripts/solutions-db/__tests__/parse.test.ts
git commit -m "feat(solutions-db): variant-key normalization + extra_fields routing (SP2)"
```

---

### Task 4: `serializeSolution` — DB row → canonical markdown (round-trip)

**Files:**

- Create: `scripts/solutions-db/lib/serialize.ts`
- Test: `scripts/solutions-db/__tests__/serialize.test.ts`

- [ ] **Step 1: Write the failing test (round-trip)**

Create `scripts/solutions-db/__tests__/serialize.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/solutions-db/__tests__/serialize.test.ts`
Expected: FAIL — `../lib/serialize` does not exist.

- [ ] **Step 3: Implement the serializer**

Create `scripts/solutions-db/lib/serialize.ts`:

```ts
import matter from "gray-matter";
import type { ProjectionInput } from "./parse";

/**
 * Serialize a solution projection back to canonical markdown.
 * Round-trips by design: parseSolution(serializeSolution(p)) reproduces p's content_hash,
 * because content_hash is over the normalized projection (not the raw bytes). Null/empty
 * fields are omitted; parse treats them as null/[], yielding the same projection.
 */
export function serializeSolution(p: ProjectionInput): string {
  const fm: Record<string, unknown> = {
    title: p.title,
    track: p.track,
    category: p.category,
  };
  if (p.module) fm.module = p.module;
  if (p.severity) fm.severity = p.severity;
  if (p.tags.length) fm.tags = p.tags;
  if (p.symptoms.length) fm.symptoms = p.symptoms;
  if (p.appliesTo.length) fm.applies_to = p.appliesTo;
  fm.created = p.created;
  if (p.lastUpdated) fm.last_updated = p.lastUpdated;
  for (const k of Object.keys(p.extraFields).sort()) fm[k] = p.extraFields[k];
  return matter.stringify("\n" + p.body.trim() + "\n", fm);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/solutions-db/__tests__/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/serialize.ts scripts/solutions-db/__tests__/serialize.test.ts
git commit -m "feat(solutions-db): serializeSolution round-trip serializer (SP2)"
```

---

### Task 5: Extract `lib/files.ts` + `lib/upsert.ts`; refactor `ingest.ts` to write `extra_fields`

**Files:**

- Create: `scripts/solutions-db/lib/files.ts`, `scripts/solutions-db/lib/upsert.ts`
- Modify: `scripts/solutions-db/ingest.ts`

- [ ] **Step 1: Create `lib/files.ts` (walk + parse, reusable)**

```ts
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSolution, type ParsedSolution } from "./parse";

export const SOLUTIONS_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "solutions",
);

export function listSolutionFiles(root: string = SOLUTIONS_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_manifests") continue;
      out.push(...listSolutionFiles(join(root, entry.name)));
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
      out.push(join(root, entry.name));
    }
  }
  return out;
}

export function parseFile(
  absPath: string,
  root: string = SOLUTIONS_ROOT,
): ParsedSolution {
  const raw = readFileSync(absPath, "utf8");
  const mtimeISO = statSync(absPath).mtime.toISOString().slice(0, 10);
  return parseSolution(raw, relative(root, absPath), mtimeISO);
}
```

- [ ] **Step 2: Create `lib/upsert.ts` (needEmbed → embed → upsert, with extra_fields)**

```ts
import type { Pool } from "pg";
import { toVectorLiteral } from "./db";
import type { ParsedSolution } from "./parse";
import { buildEmbeddingText, embedBatch, EMBED_MODEL } from "./embeddings";

/** Upsert solutions; (re-)embed only rows whose content_hash changed or that lack an embedding. */
export async function upsertSolutions(
  pool: Pool,
  parsed: ParsedSolution[],
): Promise<{ embedded: number }> {
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
          applies_to, created, last_updated, body, sections, content_hash, warnings, extra_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)
       ON CONFLICT (source_path) DO UPDATE SET
         slug=EXCLUDED.slug, title=EXCLUDED.title, track=EXCLUDED.track, category=EXCLUDED.category,
         module=EXCLUDED.module, severity=EXCLUDED.severity, tags=EXCLUDED.tags, symptoms=EXCLUDED.symptoms,
         applies_to=EXCLUDED.applies_to, created=EXCLUDED.created, last_updated=EXCLUDED.last_updated,
         body=EXCLUDED.body, sections=EXCLUDED.sections, content_hash=EXCLUDED.content_hash,
         warnings=EXCLUDED.warnings, extra_fields=EXCLUDED.extra_fields, ingested_at=now()`,
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
        JSON.stringify(p.extraFields),
      ],
    );
  }
  for (const [path, vec] of embByPath) {
    await pool.query(
      "UPDATE solutions SET embedding=$1::vector, embedding_model=$2 WHERE source_path=$3",
      [toVectorLiteral(vec), EMBED_MODEL, path],
    );
  }
  return { embedded: embByPath.size };
}
```

- [ ] **Step 3: Refactor `ingest.ts` to use both libs**

Replace the body of `scripts/solutions-db/ingest.ts` below the header comment with:

```ts
import "dotenv/config";
import { createPool } from "./lib/db";
import { listSolutionFiles, parseFile } from "./lib/files";
import { upsertSolutions } from "./lib/upsert";

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);
  const parsed = listSolutionFiles().map((f) => parseFile(f));
  const { embedded } = await upsertSolutions(pool, parsed);

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
    `Ingested ${parsed.length} files; embedded ${embedded}; ${warned} files had warnings.`,
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Verify ingest still runs (and now writes extra_fields)**

Run:

```bash
npm run solutions:db:ingest
psql "$SOLUTIONS_DATABASE_URL" -tAc "SELECT count(*) FROM solutions WHERE extra_fields <> '{}'::jsonb;"
```

Expected: ingest prints `Ingested 491 files; embedded 491; …` (491 because content_hash changed for all rows under the new definition → all re-embed; this is the one-time ~\$0.01 re-embed). The count of rows with non-empty `extra_fields` is `6` (the `source:` files).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/files.ts scripts/solutions-db/lib/upsert.ts scripts/solutions-db/ingest.ts
git commit -m "refactor(solutions-db): extract files/upsert libs; ingest writes extra_fields (SP2)"
```

---

### Task 6: `parity-check.ts` (Gate A) + pure `compareParity`

**Files:**

- Create: `scripts/solutions-db/lib/parity.ts`, `scripts/solutions-db/parity-check.ts`
- Test: `scripts/solutions-db/__tests__/parity.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test for `compareParity`**

Create `scripts/solutions-db/__tests__/parity.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/solutions-db/__tests__/parity.test.ts`
Expected: FAIL — `../lib/parity` does not exist.

- [ ] **Step 3: Implement `lib/parity.ts`**

```ts
export interface ParityRow {
  source_path: string;
  content_hash: string;
  has_embedding: boolean;
}

export interface ParityResult {
  ok: boolean;
  failures: string[];
  counts: { disk: number; db: number; nullEmbeddings: number };
}

export function compareParity(
  diskHashes: Map<string, string>,
  dbRows: ParityRow[],
): ParityResult {
  const failures: string[] = [];
  const dbByPath = new Map(dbRows.map((r) => [r.source_path, r]));

  for (const [path, hash] of diskHashes) {
    const row = dbByPath.get(path);
    if (!row) failures.push(`missing in DB: ${path}`);
    else if (row.content_hash !== hash) failures.push(`hash mismatch: ${path}`);
  }
  for (const r of dbRows) {
    if (!diskHashes.has(r.source_path))
      failures.push(`in DB but not on disk: ${r.source_path}`);
  }
  const nullEmbeddings = dbRows.filter((r) => !r.has_embedding).length;
  if (nullEmbeddings)
    failures.push(`${nullEmbeddings} rows have NULL embedding`);
  if (diskHashes.size !== dbRows.length) {
    failures.push(
      `count mismatch: disk ${diskHashes.size} vs db ${dbRows.length}`,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    counts: { disk: diskHashes.size, db: dbRows.length, nullEmbeddings },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/solutions-db/__tests__/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the CLI `parity-check.ts`**

```ts
import "dotenv/config";
import { createPool } from "./lib/db";
import { listSolutionFiles, parseFile } from "./lib/files";
import { compareParity, type ParityRow } from "./lib/parity";

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);
  const diskHashes = new Map<string, string>();
  for (const f of listSolutionFiles()) {
    const p = parseFile(f);
    diskHashes.set(p.sourcePath, p.contentHash);
  }
  const dbRows: ParityRow[] = (
    await pool.query(
      "SELECT source_path, content_hash, (embedding IS NOT NULL) AS has_embedding FROM solutions",
    )
  ).rows;
  await pool.end();

  const result = compareParity(diskHashes, dbRows);
  console.log(
    `parity: disk=${result.counts.disk} db=${result.counts.db} nullEmbeddings=${result.counts.nullEmbeddings}`,
  );
  if (!result.ok) {
    console.error(`PARITY FAILED (${result.failures.length}):`);
    for (const f of result.failures.slice(0, 50)) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PARITY OK — DB == disk (content-verified).");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Add the npm script**

In `package.json` scripts, add:

```json
"solutions:db:parity": "tsx scripts/solutions-db/parity-check.ts",
```

- [ ] **Step 7: Run Gate A against the live DB**

Run: `npm run solutions:db:parity`
Expected: `parity: disk=491 db=491 nullEmbeddings=0` then `PARITY OK …`. (If it fails on a hash mismatch, the cause is a stale row — re-run `npm run solutions:db:ingest` first; Task 5 step 4 should already have left it green.)

- [ ] **Step 8: Commit**

```bash
git add scripts/solutions-db/lib/parity.ts scripts/solutions-db/parity-check.ts scripts/solutions-db/__tests__/parity.test.ts package.json
git commit -m "feat(solutions-db): parity gate (Gate A) (SP2)"
```

---

### Task 7: `export.ts` CLI + Gate B (full-corpus round-trip)

**Files:**

- Create: `scripts/solutions-db/export.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `export.ts`**

```ts
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createPool } from "./lib/db";
import { SOLUTIONS_ROOT } from "./lib/files";
import { serializeSolution } from "./lib/serialize";
import {
  parseSolution,
  computeContentHash,
  type ProjectionInput,
} from "./lib/parse";

/** Map a DB row (snake_case, jsonb extra_fields, text[] arrays) to a ProjectionInput. */
function rowToProjection(r: Record<string, unknown>): ProjectionInput {
  return {
    title: r.title as string,
    track: r.track as ProjectionInput["track"],
    category: r.category as ProjectionInput["category"],
    module: (r.module as string | null) ?? null,
    severity: (r.severity as string | null) ?? null,
    tags: (r.tags as string[]) ?? [],
    symptoms: (r.symptoms as string[]) ?? [],
    appliesTo: (r.applies_to as string[]) ?? [],
    created: r.created as string,
    lastUpdated: (r.last_updated as string | null) ?? null,
    extraFields: (r.extra_fields as Record<string, unknown>) ?? {},
    body: r.body as string,
  };
}

// to_char keeps DATE columns as clean 'YYYY-MM-DD' strings (avoids node-pg's Date tz drift).
const SELECT_ALL = `
  SELECT source_path, title, track, category, module, severity, tags, symptoms, applies_to,
         to_char(created,'YYYY-MM-DD') AS created,
         to_char(last_updated,'YYYY-MM-DD') AS last_updated,
         body, extra_fields, content_hash
  FROM solutions`;

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const pool = createPool(url);

  if (args.includes("--verify")) {
    // Gate B: in-memory round-trip across ALL rows. Does NOT touch disk.
    const rows = (await pool.query(SELECT_ALL)).rows;
    await pool.end();
    const mismatches: string[] = [];
    for (const r of rows) {
      const proj = rowToProjection(r);
      const md = serializeSolution(proj);
      const reparsed = parseSolution(md, r.source_path, proj.created);
      if (reparsed.contentHash !== computeContentHash(proj))
        mismatches.push(r.source_path);
    }
    if (mismatches.length) {
      console.error(`ROUND-TRIP FAILED for ${mismatches.length} rows:`);
      for (const m of mismatches.slice(0, 50)) console.error(`  - ${m}`);
      process.exit(1);
    }
    console.log(
      `ROUND-TRIP OK — all ${rows.length} rows serialize→parse to an identical hash.`,
    );
    return;
  }

  const all = args.includes("--all");
  const single = args.find((a) => !a.startsWith("--"));
  const where = all ? "" : " WHERE source_path = $1";
  const params = all ? [] : [single];
  if (!all && !single) {
    console.error("usage: export.ts (--all | <source_path>) | --verify");
    process.exit(1);
  }
  const rows = (await pool.query(SELECT_ALL + where, params)).rows;
  await pool.end();
  for (const r of rows) {
    const md = serializeSolution(rowToProjection(r));
    const abs = join(SOLUTIONS_ROOT, r.source_path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, md, "utf8");
  }
  console.log(`Exported ${rows.length} file(s).`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, add:

```json
"solutions:db:export": "tsx scripts/solutions-db/export.ts",
```

- [ ] **Step 3: Run Gate B (full-corpus round-trip)**

Run: `npm run solutions:db:export -- --verify`
Expected: `ROUND-TRIP OK — all 491 rows serialize→parse to an identical hash.` If any row fails, the serializer/parser disagree on that row — inspect it (likely an exotic `extra_fields` value) before proceeding.

- [ ] **Step 4: Smoke-test single-file export (non-destructive check)**

Run:

```bash
npm run solutions:db:export -- conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md
git status --porcelain docs/solutions/ | head
```

Expected: the named file is rewritten in canonical form (it may show as modified — that's expected for a re-exported file; `docs/solutions/` is gitignored so it won't appear in `git status` of tracked files, but the file mtime updates). Re-running `npm run solutions:db:parity` still reports OK (content-hash unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/export.ts package.json
git commit -m "feat(solutions-db): export CLI + full-corpus round-trip (Gate B) (SP2)"
```

---

### Task 8: `add.ts` — the single write path

**Files:**

- Create: `scripts/solutions-db/add.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `add.ts`**

```ts
import "dotenv/config";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createPool, toVectorLiteral } from "./lib/db";
import { SOLUTIONS_ROOT } from "./lib/files";
import { parseSolution } from "./lib/parse";
import { buildEmbeddingText, embedBatch } from "./lib/embeddings";
import { upsertSolutions } from "./lib/upsert";
import { serializeSolution } from "./lib/serialize";

const NEAR_DUP_THRESHOLD = 0.88;

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error("usage: add.ts <path-to-markdown> [--dry-run]");
    process.exit(1);
  }
  const abs = isAbsolute(fileArg) ? fileArg : join(process.cwd(), fileArg);
  const sourcePath = relative(SOLUTIONS_ROOT, abs);
  const raw = readFileSync(abs, "utf8");
  const mtimeISO = statSync(abs).mtime.toISOString().slice(0, 10);
  const parsed = parseSolution(raw, sourcePath, mtimeISO);

  for (const w of parsed.warnings) console.error(`warning: ${w}`);

  const pool = createPool(url);

  // Near-dup check (advisory): embed the new content, find cosine neighbors >= threshold.
  const [vec] = await embedBatch([
    buildEmbeddingText(parsed.title, parsed.body),
  ]);
  const neighbors = (
    await pool.query(
      `SELECT source_path, 1 - (embedding <=> $1::vector) AS sim
       FROM solutions
       WHERE embedding IS NOT NULL AND source_path <> $2
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 5`,
      [toVectorLiteral(vec), sourcePath],
    )
  ).rows as { source_path: string; sim: number }[];
  for (const n of neighbors) {
    if (Number(n.sim) >= NEAR_DUP_THRESHOLD) {
      console.error(
        `near-duplicate: ${n.source_path} (cosine ${Number(n.sim).toFixed(3)})`,
      );
    }
  }

  if (dryRun) {
    console.log("dry-run: not written.");
    await pool.end();
    return;
  }

  await upsertSolutions(pool, [parsed]);

  // Export the canonical mirror for this row so disk matches the DB.
  const row = (
    await pool.query(
      `SELECT title, track, category, module, severity, tags, symptoms, applies_to,
              to_char(created,'YYYY-MM-DD') AS created,
              to_char(last_updated,'YYYY-MM-DD') AS last_updated, body, extra_fields
       FROM solutions WHERE source_path = $1`,
      [sourcePath],
    )
  ).rows[0];
  writeFileSync(
    abs,
    serializeSolution({
      title: row.title,
      track: row.track,
      category: row.category,
      module: row.module ?? null,
      severity: row.severity ?? null,
      tags: row.tags ?? [],
      symptoms: row.symptoms ?? [],
      appliesTo: row.applies_to ?? [],
      created: row.created,
      lastUpdated: row.last_updated ?? null,
      extraFields: row.extra_fields ?? {},
      body: row.body,
    }),
    "utf8",
  );
  await pool.end();
  console.log(`Added ${sourcePath} to the DB and exported its mirror.`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, add:

```json
"solutions:db:add": "tsx scripts/solutions-db/add.ts",
```

- [ ] **Step 3: Verify `--dry-run` finds a near-dup and writes nothing**

Run:

```bash
npm run solutions:db:add -- docs/solutions/conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md --dry-run
```

Expected: prints `dry-run: not written.`; likely emits a `near-duplicate:` line for its sibling (the pg-pooled-connection solution). `npm run solutions:db:parity` still OK (no write happened).

- [ ] **Step 4: Verify a real add is idempotent**

Run:

```bash
npm run solutions:db:add -- docs/solutions/conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md
npm run solutions:db:parity
```

Expected: `Added … and exported its mirror.` then `PARITY OK` with `db=491` (re-adding an existing file updates in place; count unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/add.ts package.json
git commit -m "feat(solutions-db): add.ts single-file write path (SP2)"
```

---

### Task 9: Hook cut-over — DB query with markdown fallback (shipped dark)

**Files:**

- Modify: `.claude/hooks/inject-patterns.sh`

- [ ] **Step 1: Extract today's markdown logic into `solutions_from_markdown`**

In `.claude/hooks/inject-patterns.sh`, wrap the existing solution-discovery block (the `if [ -d "$SOLUTIONS_DIR" ]; then … fi` spanning ~lines 149–207, which produces `$MATCHES`) into a function that **prints** the `source_rel<TAB>title` lines instead of emitting them inline. Define it above the `if [ -n "$DOMAINS" ]` loop:

```bash
# Emit "source_rel<TAB>title" lines for a domain from the markdown files (today's logic).
# Uses $_FILE_REL, $TAG_PATTERN-style matching, $SOLUTIONS_DIR, $SOLUTIONS_PER_DOMAIN, $PROJECT_ROOT.
solutions_from_markdown() {
  local domain="$1" tag_pattern="$2"
  [ -d "$SOLUTIONS_DIR" ] || return 0
  local matches
  matches=$(grep -rl --include='*.md' -E "^tags:.*${tag_pattern}" \
    "$SOLUTIONS_DIR" 2>/dev/null | grep -v '/_manifests/' \
    | sed "s|.*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)\.md\$|\1 &|" \
    | sort -r | cut -d' ' -f2- | head -n "$SOLUTIONS_PER_DOMAIN" || true)
  [ -n "$matches" ] || return 0
  local priority="" fallback="" nl=$'\n'
  while IFS= read -r sol; do
    [ -n "$sol" ] || continue
    local pats matched=false
    pats=$(grep -m1 '^applies_to:' "$sol" 2>/dev/null | grep -oE '"[^"]+"' | tr -d '"' || true)
    if [ -n "$pats" ]; then
      while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        # shellcheck disable=SC2254
        [[ "$_FILE_REL" == $pat ]] && { matched=true; break; }
      done <<< "$pats"
    fi
    if [ "$matched" = true ]; then priority="${priority:+$priority$nl}$sol"; else fallback="${fallback:+$fallback$nl}$sol"; fi
  done <<< "$matches"
  matches=$(printf '%s\n%s\n' "$priority" "$fallback" | grep -v '^$' | head -n "$SOLUTIONS_PER_DOMAIN")
  while IFS= read -r sol_file; do
    [ -n "$sol_file" ] || continue
    local rel title
    rel="${sol_file#"$PROJECT_ROOT"/}"
    rel="${rel#docs/solutions/}"
    title=$(grep -m1 -E '^title:' "$sol_file" 2>/dev/null | sed -E 's/^title:[[:space:]]*//; s/^"//; s/"$//' || true)
    printf '%s\t%s\n' "$rel" "${title:-untitled}"
  done <<< "$matches"
}
```

- [ ] **Step 2: Add `solutions_from_db` (psql tag-query, bash-side date-sort + glob promotion)**

```bash
# Emit "source_rel<TAB>title" lines for a domain from the DB. Returns non-zero on psql failure.
solutions_from_db() {
  local domain="$1"
  [ -n "${SOLUTIONS_DB_READONLY_URL:-}" ] || return 1
  local where
  if [ "$domain" = "ai-prompting" ]; then
    where="(tags && ARRAY['ai']::text[] OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t LIKE 'ai-%'))"
  else
    where="tags && ARRAY['${domain}']::text[]"
  fi
  local rows
  rows=$(psql "$SOLUTIONS_DB_READONLY_URL" -tAF$'\t' -c \
    "SELECT source_path, title, array_to_string(applies_to,'|') FROM solutions WHERE ${where} LIMIT 200;" \
    2>/dev/null) || return 1
  [ -n "$rows" ] || return 0
  # Date-sort by the YYYY-MM-DD embedded in source_path (mirrors the markdown path's filename sort).
  local sorted
  sorted=$(printf '%s\n' "$rows" | awk -F'\t' '{
    if (match($1, /[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$/)) d=substr($1, RSTART, 10); else d="0000-00-00";
    print d "\t" $0 }' | sort -rk1,1 | cut -f2-)
  local priority="" fallback="" nl=$'\n' tab=$'\t'
  while IFS=$'\t' read -r sp title pats; do
    [ -n "$sp" ] || continue
    local matched=false pat patarr=()
    if [ -n "$pats" ]; then
      IFS='|' read -ra patarr <<< "$pats"   # IFS scoped to this read only — no leak
      for pat in "${patarr[@]}"; do
        [ -n "$pat" ] || continue
        # shellcheck disable=SC2254
        [[ "$_FILE_REL" == $pat ]] && { matched=true; break; }
      done
    fi
    local rel="${sp#docs/solutions/}"
    if [ "$matched" = true ]; then priority="${priority:+$priority$nl}${rel}${tab}${title}"; else fallback="${fallback:+$fallback$nl}${rel}${tab}${title}"; fi
  done <<< "$sorted"
  printf '%s\n%s\n' "$priority" "$fallback" | grep -v '^$' | head -n "$SOLUTIONS_PER_DOMAIN"
}
```

- [ ] **Step 3: Add the dispatcher and emit from it**

Replace the in-loop solution block with a call that picks DB-or-markdown and formats the emitted refs. Inside the `for DOMAIN in …` loop, after the rules-injection and the dedup check, replace the old `$MATCHES`-building+emit section with:

```bash
    TAG_PATTERN=$(domain_tag_pattern "$DOMAIN")
    # DB path when enabled AND the query succeeds (exit 0 — even if empty, which means
    # "legitimately no refs"). Otherwise (markdown mode OR psql failure) use the mirror.
    # The command substitution's exit status IS solutions_from_db's return, so one call decides.
    if [ "${PATTERN_INJECT_SOURCE:-db}" != "markdown" ] && SOLUTION_LINES=$(solutions_from_db "$DOMAIN"); then
      :
    else
      SOLUTION_LINES=$(solutions_from_markdown "$DOMAIN" "$TAG_PATTERN")
    fi
    if [ -n "$SOLUTION_LINES" ]; then
      printf '\n[SOLUTIONS — %s (Read the file for the full body)]\n' "$DOMAIN" >> "$TMPFILE"
      while IFS=$'\t' read -r rel title; do
        [ -n "$rel" ] || continue
        printf -- '- docs/solutions/%s — %s\n' "$rel" "${title:-untitled}" >> "$TMPFILE"
      done <<< "$SOLUTION_LINES"
    fi
```

> Note: the default is `db`. The "shipped dark" safety in Step 5 is achieved by exporting `PATTERN_INJECT_SOURCE=markdown` during verification — the code defaults to `db` but Gate C (Task 10) proves equivalence before anyone relies on it. To ship truly dark instead, set the default to `markdown` here and flip it to `db` in Task 10 Step 4.

- [ ] **Step 4: Manually verify both paths produce identical refs for one file**

Run (simulates a PreToolUse event for a storage file, which maps to `database`/`security`/`architecture`):

```bash
EV='{"tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/server/storage/cookbooks.ts"},"session_id":""}'
echo "$EV" | PATTERN_INJECT_SOURCE=markdown bash .claude/hooks/inject-patterns.sh | jq -r '.hookSpecificOutput.additionalContext' | grep -A40 'SOLUTIONS' > /tmp/sp2_md.txt
echo "$EV" | PATTERN_INJECT_SOURCE=db       bash .claude/hooks/inject-patterns.sh | jq -r '.hookSpecificOutput.additionalContext' | grep -A40 'SOLUTIONS' > /tmp/sp2_db.txt
diff /tmp/sp2_md.txt /tmp/sp2_db.txt && echo "IDENTICAL"
```

Expected: `IDENTICAL` (or a small, explainable ordering diff — investigate any difference before Task 10).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/inject-patterns.sh
git commit -m "feat(hooks): DB-backed solution injection with markdown fallback (SP2)"
```

---

### Task 10: Gate C — automated hook equivalence across all domains, then confirm `db` default

**Files:**

- Create: `scripts/solutions-db/hook-equivalence-check.ts`

- [ ] **Step 1: Implement the equivalence check (runs the real bash hook both ways)**

```ts
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const HOOK = join(REPO_ROOT, ".claude", "hooks", "inject-patterns.sh");

// One representative edited path per domain (covers the domain-map rows).
const PROBES: string[] = [
  "server/routes/recipes.ts", // api, security, architecture
  "server/storage/cookbooks.ts", // database, security, architecture
  "server/middleware/auth.ts", // security, api
  "server/services/photo-analysis.ts", // architecture, ai-prompting
  "client/screens/HomeScreen.tsx", // react-native, design-system, accessibility
  "client/components/Button.tsx", // + performance
  "client/hooks/useThing.ts", // hooks, client-state, react-native, accessibility
  "client/lib/format.ts", // typescript, client-state
  "shared/schema.ts", // database, security, architecture
  "evals/runner.ts", // ai-prompting, testing
  "client/components/__tests__/Button.test.tsx", // testing
];

function solutionRefs(filePath: string, source: "db" | "markdown"): string {
  const event = JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: join(REPO_ROOT, filePath) },
    session_id: "",
  });
  const out = execFileSync("bash", [HOOK], {
    input: event,
    env: { ...process.env, PATTERN_INJECT_SOURCE: source },
    encoding: "utf8",
  });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
  // Keep only the solution-ref lines (stable, source-independent formatting).
  return ctx
    .split("\n")
    .filter((l) => l.startsWith("- docs/solutions/"))
    .sort()
    .join("\n");
}

let failures = 0;
for (const probe of PROBES) {
  const md = solutionRefs(probe, "markdown");
  const db = solutionRefs(probe, "db");
  if (md !== db) {
    failures++;
    console.error(`MISMATCH for ${probe}:`);
    console.error(
      "  markdown-only:\n" +
        md
          .split("\n")
          .filter((l) => !db.includes(l))
          .map((l) => "    " + l)
          .join("\n"),
    );
    console.error(
      "  db-only:\n" +
        db
          .split("\n")
          .filter((l) => !md.includes(l))
          .map((l) => "    " + l)
          .join("\n"),
    );
  } else {
    console.log(
      `ok: ${probe} (${db.split("\n").filter(Boolean).length} refs match)`,
    );
  }
}
if (failures) {
  console.error(
    `\nGATE C FAILED: ${failures}/${PROBES.length} probes diverged.`,
  );
  process.exit(1);
}
console.log(
  `\nGATE C OK — db and markdown paths agree across all ${PROBES.length} probes.`,
);
```

- [ ] **Step 2: Run Gate C**

Run: `npx tsx scripts/solutions-db/hook-equivalence-check.ts`
Expected: `ok: …` for each probe, then `GATE C OK …`. Investigate and fix any `MISMATCH` (usual cause: a sort-order or `_FILE_REL` prefix-stripping difference between the two functions) before continuing.

- [ ] **Step 3: Add a convenience npm script (optional but recommended)**

In `package.json` scripts, add:

```json
"solutions:db:hook-check": "tsx scripts/solutions-db/hook-equivalence-check.ts",
```

- [ ] **Step 4: Confirm the `db` default is live**

The dispatcher (Task 9 Step 3) already defaults to `db`. With Gate C green, no flip is needed — confirm by running an edit-triggering action and checking the injected context cites DB-sourced refs (or simply trust the green Gate C). If Task 9 was shipped with a `markdown` default instead, change `${PATTERN_INJECT_SOURCE:-db}` to confirm `db` and re-run Gate C.

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/hook-equivalence-check.ts package.json
git commit -m "test(solutions-db): hook equivalence gate (Gate C) (SP2)"
```

---

### Task 11: Cut over the write skills (`codify`, `audit`, `todo`)

**Files:**

- Modify: `.claude/skills/codify/SKILL.md`, `.claude/skills/audit/SKILL.md`, `.claude/skills/todo/SKILL.md`

- [ ] **Step 1: Update `codify` Step 6b (overlap-check) and 6c (write)**

In `.claude/skills/codify/SKILL.md`, in Step 6b replace the `rg`-based within-category overlap scan instruction with:

> **6b. Overlap-check (advisory, DB-backed):** run `npm run solutions:db:add -- <draft-file> --dry-run`. It embeds the draft and reports `near-duplicate: <path> (cosine …)` for any existing solution at cosine ≥ 0.88 (semantic — catches paraphrased duplicates lexical Jaccard misses). Advisory only: surface the duplicates, then proceed (the user may merge or add a `## See Also`).

In Step 6c replace "Write the file" with:

> **6c. Write:** compose the solution markdown as before, write it to its `docs/solutions/<category>/<slug>-YYYY-MM-DD.md` path, then run `npm run solutions:db:add -- docs/solutions/<category>/<slug>-YYYY-MM-DD.md`. This inserts/embeds the row into the canonical DB and re-exports the file in canonical form. The DB is the source of truth; the file is its mirror.

In Step 7 (commit) replace the solution-file `git add` with a note:

> Solution content now lives in the DB (the `docs/solutions/` mirror is gitignored, as before — nothing to commit there). Commit only any `.claude/agents/*.md` files you also updated.

- [ ] **Step 2: Update `audit` and `todo` codification steps**

In `.claude/skills/audit/SKILL.md` and `.claude/skills/todo/SKILL.md`, find each instruction that writes a `docs/solutions/` file during codification and append: "then run `npm run solutions:db:add -- <that-file>` so the canonical DB and its mirror are updated (see `/codify` Step 6c)."

- [ ] **Step 3: Verify the skills reference the real script**

Run: `grep -rn "solutions:db:add" .claude/skills/`
Expected: matches in `codify/SKILL.md`, `audit/SKILL.md`, `todo/SKILL.md`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/codify/SKILL.md .claude/skills/audit/SKILL.md .claude/skills/todo/SKILL.md
git commit -m "docs(skills): codify/audit/todo write via solutions:db:add (SP2)"
```

---

### Task 12: Prose redirect — 11 agents + 4 core docs

**Files:**

- Modify: `.claude/agents/{accessibility-specialist,architecture-specialist,camera-specialist,code-reviewer,database-specialist,nutrition-domain-expert,performance-specialist,rn-ui-ux-specialist,security-auditor,testing-specialist,todo-executor}.md`
- Modify: `docs/PATTERNS.md`, `CLAUDE.md`, `docs/AI_DRIFT_CHECKLIST.md`, `docs/DEV_SETUP.md`

- [ ] **Step 1: Redirect each agent's `docs/solutions/` reference**

For each of the 11 agent files, locate the sentence that points the agent at `docs/solutions/` for codified knowledge and replace it with this canonical wording (adjust surrounding phrasing minimally to fit):

> Codified knowledge lives in the **solutions DB** (`ocrecipes_solutions`). Query it mid-session via the MCP tools `search_solutions` (semantic), `get_solution`, and `related_solutions`. The `docs/solutions/*.md` tree is a **regenerated read-only mirror** (a fallback for offline/grep use — never the source of truth).

Verify each file individually with `grep -n "docs/solutions" .claude/agents/<file>.md` before and after, so no reference is missed and none is left describing the files as canonical.

- [ ] **Step 2: Update `docs/PATTERNS.md`**

In the knowledge-base layout section, change the `docs/solutions/` description to: "Canonical store is the `ocrecipes_solutions` Postgres DB (semantic + structured search via the MCP server). The `docs/solutions/*.md` files are a regenerated mirror; author new solutions with `/codify` (which writes the DB via `npm run solutions:db:add`)."

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Key Patterns" paragraph describing the inject hook, add: "The injection hook reads solution references from the `ocrecipes_solutions` DB (via `psql`), falling back to the gitignored markdown mirror if the DB is unreachable (`PATTERN_INJECT_SOURCE=markdown` forces the fallback). `docs/rules/*.md` is still injected from disk." Update the codify pointer to mention `solutions:db:add`.

- [ ] **Step 4: Update `docs/AI_DRIFT_CHECKLIST.md`**

Update any check that inspects `docs/solutions/` to instead (or also) verify DB parity: add a checklist item "Run `npm run solutions:db:parity` — DB and mirror agree (491==491, zero NULL embeddings)."

- [ ] **Step 5: Update `docs/DEV_SETUP.md`**

Add a "Solutions DB" subsection documenting: the `SOLUTIONS_DATABASE_URL` and `SOLUTIONS_DB_READONLY_URL` env vars (in `~/.zshenv`); first-time setup `createdb ocrecipes_solutions` → `npm run solutions:db:init` → `npm run solutions:db:ingest`; and that the injection hook needs `SOLUTIONS_DB_READONLY_URL` (absent → automatic markdown-mirror fallback, no breakage).

- [ ] **Step 6: Verify no file still calls the markdown tree canonical**

Run:

```bash
grep -rln "docs/solutions" .claude/agents/ docs/PATTERNS.md CLAUDE.md docs/AI_DRIFT_CHECKLIST.md docs/DEV_SETUP.md
```

Expected: every listed file now describes the DB as canonical and the markdown as a mirror (spot-check a couple).

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/ docs/PATTERNS.md CLAUDE.md docs/AI_DRIFT_CHECKLIST.md docs/DEV_SETUP.md
git commit -m "docs: redirect agents + core docs to DB-canonical solutions store (SP2)"
```

---

### Task 13: Final verification — full gate sweep + test suite

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests (CI-safe subset)**

Run: `npx vitest run scripts/solutions-db/__tests__/`
Expected: all pass with no DB/API key needed (lazy-init libs; pure functions).

- [ ] **Step 2: Re-run all three gates**

Run:

```bash
npm run solutions:db:ingest        # idempotent; embeds nothing new
npm run solutions:db:parity        # Gate A
npm run solutions:db:export -- --verify   # Gate B
npx tsx scripts/solutions-db/hook-equivalence-check.ts  # Gate C
```

Expected: ingest reports `embedded 0`; Gate A `PARITY OK db=491`; Gate B `ROUND-TRIP OK all 491`; Gate C `GATE C OK`.

- [ ] **Step 3: Confirm untouched surfaces**

Run:

```bash
npm run build:copilot-instructions:check   # rules→copilot generation unaffected
git diff --stat main...HEAD -- docs/rules/ | tail -1   # expect: no docs/rules/*.md content changes beyond prose cross-links if any
```

Expected: copilot-instructions check passes; `docs/rules/*.md` substantively unchanged.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/solutions-db-sp2
```

Then finish via `superpowers:finishing-a-development-branch` (PR or local merge).

---

## Notes for the implementer

- **Re-embed cost:** Task 5 Step 4 re-embeds all 491 rows once (the hash definition changed). This is expected and costs ~\$0.01. Subsequent ingests embed 0.
- **`docs/solutions/` is gitignored** — exported/added files won't appear in `git status` of tracked files. That's correct; the DB is the record. Do **not** `git add -f` them.
- **Bash escaping** in the hook (Task 9) is the highest-risk code; rely on Task 9 Step 4 (manual diff) and Task 10 (Gate C) to catch escaping/sort bugs — do not declare the hook done on a green `tsc` alone.
- **Do not weaken the read-only MCP server.** All writes go through `add.ts` (owner role). The server keeps `solutions_ro`.
