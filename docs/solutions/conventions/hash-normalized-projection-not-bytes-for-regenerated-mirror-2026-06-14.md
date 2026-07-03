---
title: 'Hash a normalized projection, not raw bytes, when files mirror a canonical store'
track: knowledge
category: conventions
module: shared
tags: [content-hash, serialization, mirror, canonical-store, database, architecture, parity, sync, shared]
symptoms: ['A ''has this file changed?'' hash flips on a no-op reformat (key reorder, quoting, whitespace)', Re-exporting a file from the DB makes a byte-hash parity check fail even though nothing changed, You want to regenerate files from a store but a raw-bytes hash makes them look perpetually dirty]
applies_to: [scripts/solutions-db/**/*.ts]
created: '2026-06-14'
---

# Hash a normalized projection, not raw bytes, when files mirror a canonical store

## When this applies

When a store (DB) is canonical and the on-disk files are a **regenerated mirror** of it — i.e.
the files can be re-serialized from the store at any time. The "is the file in sync with the
store?" check (and any change-detection / re-embed trigger keyed on it) must hash a **normalized
projection** of the meaningful fields, not the raw file bytes.

## Smell patterns

- `content_hash = sha256(rawFileText)` on data that also gets **written back** from the store.
- A parity/round-trip check that does a byte `diff` between an exported file and its original.
- Re-running an exporter produces a large no-op reformat diff that trips your change detector.

## Why

A raw-bytes hash is correct only while files are never regenerated. The moment you serialize from
the store, the output won't be byte-identical to a hand-authored original (YAML key order, quoting
style, `date:` vs `created:`, trailing whitespace all differ) — yet the *content* is identical. A
byte-hash then reports false drift on every regenerated file, and a parity gate built on it fails
spuriously. The right invariant is **semantic equality**: hash a deterministic projection of the
known fields + body, independent of serialization. Then `serialize → re-parse → same hash` holds,
so the mirror is provably faithful and the exporter is free to emit canonical form.

This also *upgrades* dedup: a normalized hash groups semantically-identical-but-reformatted files
that a byte-hash would miss.

## Examples

```ts
// Deterministic, serialization-independent: fixed key order, deep-sorted extras, trimmed body.
export function canonicalProjection(p: ProjectionInput): string {
  const fields = {
    title: p.title, track: p.track, category: p.category,
    module: p.module ?? null, severity: p.severity ?? null,
    tags: p.tags, symptoms: p.symptoms, applies_to: p.appliesTo,
    created: p.created, last_updated: p.lastUpdated ?? null,
    extra: deepSortKeys(p.extraFields), // shallow sort is NOT enough — jsonb reorders nested keys
  };
  return JSON.stringify(fields) + "\n" + p.body.trim();
}
export const computeContentHash = (p: ProjectionInput) =>
  sha256(canonicalProjection(p));
```

Two cautions learned here: **deep-sort** nested object keys (Postgres `jsonb` reorders nested keys
on read, so a shallow sort breaks round-trip), and keep array element order significant (reordering
tags IS a real change). One shared function — imported by ingest, parity, export, and the
round-trip test — never reimplemented.

## Exceptions

- If files are authored-only and never regenerated, a raw-bytes hash is fine (and simpler).
- Switching an existing store from a bytes-hash to a projection-hash changes every stored hash →
  budget a one-time full re-ingest/re-embed.
- The **serializer's text format becomes a contract** for any tool that greps the mirror (e.g. an
  inject hook). A projection-hash is format-agnostic, so it will NOT catch a format regression that
  breaks a grep consumer — lock the serializer's format (e.g. inline `tags: [...]`) with its own test.

## Related Files

- `scripts/solutions-db/lib/parse.ts` — `canonicalProjection` / `computeContentHash` / `deepSortKeys`
- `scripts/solutions-db/lib/serialize.ts` — the inverse serializer (must round-trip to the same hash)
- `scripts/solutions-db/parity-check.ts`, `export.ts --verify` — the gates built on the projection hash

## See Also

- [gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md](gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — parity over the same hash on both sides can't prove the hash/parser is correct
- [../logic-errors/zod-array-string-drops-yaml-scalar-tags-2026-06-14.md](../logic-errors/zod-array-string-drops-yaml-scalar-tags-2026-06-14.md) — a parser bug the projection hash agreed on (wrongly) on both sides
