---
title: 'Map OpenAI batch embeddings by response index, never by array position'
track: bug
category: logic-errors
module: server
severity: high
tags: [openai, embeddings, ai-integration, pgvector, batch, data-integrity, reliability, server]
symptoms: [Semantic search returns the wrong document for a query that should match exactly, An item's stored vector seems to belong to a different item in the same batch, 'No error, no crash — embeddings are silently attached to the wrong rows']
applies_to: [scripts/solutions-db/lib/embeddings.ts, server/services/**/*.ts]
created: '2026-06-14'
---

# Map OpenAI batch embeddings by response index, never by array position

## Problem

When embedding a batch of texts, attaching each returned vector to the input by **position**
(`for (const d of res.data) out.push(d.embedding)`) assumes `res.data` is in input order. The
OpenAI embeddings response is **not contractually ordered** — each item carries an `index` field
precisely so the caller can reorder. If any chunk comes back reordered, vectors attach to the
wrong items. It is silent (no error), on the primary ingest path, and invisible to any
content-hash gate (those compare text, never embeddings).

## Symptoms

- Semantic search ranks an unrelated doc first for a query that should be an exact hit.
- A row's `embedding` is really another row's vector (same batch).
- Everything "looks fine" — counts, hashes, and `NOT NULL embedding` checks all pass.

## Root Cause

`client.embeddings.create({ input: chunk })` returns `{ data: Embedding[] }` where each
`Embedding` has an `index` (0-based **within that request**). The API docs do not guarantee
`data` is in input order; the `index` field exists so order can be reconstructed. Positional
accumulation (`out.push(...)`) and positional re-attachment downstream
(`needEmbed.forEach((p, i) => map.set(p.path, vectors[i]))`) both bake in the unguaranteed
ordering assumption.

## Solution

Place each embedding at `d.index` within the chunk before appending — and mind that `index` is
**per-request**, not global:

```ts
const res = await client.embeddings.create({ model, input: chunk });
const chunkOut: number[][] = new Array<number[]>(chunk.length);
for (const d of res.data) chunkOut[d.index] = d.embedding as number[];
out.push(...chunkOut); // chunkOut is now in input order; downstream positional map is safe
```

If existing data may already be mis-mapped, force a one-time re-embed under the fixed code
(`UPDATE … SET embedding = NULL` then re-ingest) — re-embedding doesn't change `content_hash`,
so a parity gate stays green.

## Prevention

- Treat any provider batch response as **unordered** unless the docs explicitly promise order;
  key off the response's own `index`/`id`, not the loop counter.
- Add a reviewer rule for AI batch calls (see Related Files → ai-llm-specialist).
- Remember a content/parity gate cannot catch this — only an end-to-end semantic assertion can.

## Related Files

- `scripts/solutions-db/lib/embeddings.ts` — `embedBatch` (the fix)
- `scripts/solutions-db/lib/upsert.ts` — downstream positional `vectors[i]` map (safe once embedBatch is ordered)

## See Also

- [../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md](../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — why no hash gate caught this; use an independent reader
