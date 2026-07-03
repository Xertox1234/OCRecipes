---
title: 'gray-matter throws synchronously on malformed YAML frontmatter, bypassing tolerant validation'
track: bug
category: runtime-errors
module: server
severity: medium
tags: [gray-matter, js-yaml, frontmatter, ingestion, parsing, error-handling]
symptoms: [A batch ingest/parse run crashes on a single file instead of skipping or warning, 'An unhandled exception from js-yaml (e.g. ''unidentified alias'', ''reserved indicator'') aborts the whole pass', A parser designed to accumulate warnings still throws before any warning is recorded]
applies_to: [scripts/**/*.ts]
created: '2026-06-13'
---

# gray-matter throws synchronously on malformed YAML frontmatter, bypassing tolerant validation

## Problem

A markdown parser built for *tolerant* ingestion (collect `warnings[]`, never hard-skip a file) wrapped its validation in `zod.safeParse`, assuming that handled all bad input. But `gray-matter` parses the YAML frontmatter **before** any zod layer runs, and `js-yaml` (which gray-matter uses) **throws synchronously** on malformed YAML. A single bad file aborted the entire 487-file ingest.

The malformed cases were real and subtle under YAML 1.1:

- A `symptoms:` list entry starting with `*` is interpreted as an **alias sigil** → `*.tsx files break` → "unidentified alias" throw.
- A leading backtick is a **reserved indicator**.

```ts
// BUGGY — matter() throws before warnings can be collected:
const parsed = matter(raw);                       // <-- throws on bad YAML, crashes the run
const fm = FrontmatterSchema.safeParse(parsed.data);
```

## Symptoms

- One malformed file in a corpus crashes a whole batch ingest.
- The stack trace points into `js-yaml`, not your validation code.
- `zod.safeParse` never gets a chance to run — the throw is upstream of it.

## Root Cause

`gray-matter`/`js-yaml` raise exceptions for YAML syntax errors. `safeParse` only protects against *shape* mismatches on already-parsed data — it cannot catch a parse-time throw. Tolerant-ingestion designs that rely solely on `safeParse` have an unguarded crash surface at the `matter()` call.

## Solution

Wrap `matter()` in try/catch and degrade to a body-only fallback (empty frontmatter, strip a leading `---…---` block), recording a warning instead of crashing:

```ts
let data: z.infer<typeof FrontmatterSchema> = {};
let content = raw;
try {
  const parsed = matter(raw);
  content = parsed.content;
  const fm = FrontmatterSchema.safeParse(parsed.data);
  if (fm.success) data = fm.data;
  else warnings.push("frontmatter failed schema validation; using best-effort values");
} catch (e) {
  warnings.push(`frontmatter parse error (${(e as Error).message.split("\n")[0]}); treated as body-only`);
  content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
```

Add a unit test with genuinely malformed YAML (e.g. a `symptoms:` entry starting with `*`) asserting it does **not** throw and produces a warning.

## Prevention

Any library that *parses* external/authored text (YAML, JSON5, TOML, a custom DSL) can throw before your validation layer. In a tolerant pipeline, the parse call itself must be in try/catch — `safeParse`-style validation is necessary but not sufficient.

## Related Files

- `scripts/solutions-db/lib/parse.ts` — `parseSolution()`, the guarded `matter()` call
- `scripts/solutions-db/__tests__/parse.test.ts` — malformed-YAML regression test

## See Also

- [../conventions/zod-safeparse-external-api-responses-2026-05-13.md](../conventions/zod-safeparse-external-api-responses-2026-05-13.md) — validate external data with safeParse (the necessary-but-not-sufficient half of this lesson)
