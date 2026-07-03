---
title: A gate comparing two derivations of the same function is blind to that function's bugs
track: knowledge
category: conventions
module: shared
tags: [verification, testing, gates, parity, round-trip, code-review, independent-reader, reliability, shared]
symptoms: ['A parity/round-trip gate is green, yet the underlying data is wrong', Both sides of a correctness check are computed by the same parser/serializer/hash, A bug survived a passing gate because the gate could only see what that function produced]
applies_to: [scripts/solutions-db/**/*.ts]
created: '2026-06-14'
---

# A gate comparing two derivations of the same function is blind to that function's bugs

## Rule

When you build a correctness gate, make its two sides **independent readers** of the source of
truth. A gate that compares `f(x)` on disk to `f(x)` in a store proves the store mirrors `f` —
it cannot prove `f` is correct, because a bug in `f` corrupts both sides identically and the
comparison still passes. To catch `f`'s own bugs you need a *second, independent* derivation
(a different reader, a raw view, a hand-computed expectation).

## Smell patterns

- A "parity" check: `hash(parse(file))` vs `hash(parse-stored-from(file))` — same `parse`, same `hash`.
- A round-trip: `serialize → parse → equals original` — passes for any self-consistent but wrong codec.
- "All gates green, ship it" when every gate is downstream of one parser/serializer.

## Why

This bit us concretely. A parity gate compared each solution file's `content_hash` (from the
parser) to the DB row's `content_hash` (from the **same** parser at ingest). When the parser
silently dropped numeric/`null` YAML tags, *both* sides agreed on the empty-tag hash — parity
stayed green while the canonical store held wrong data. What caught it was a **different** gate:
a hook-equivalence check that compared the raw `grep` of the file's `tags:` line (one reader)
against the parsed DB tags (another reader). Two genuinely independent readers disagreed exactly
where the parser was wrong — and the disagreement *was* the bug.

The corollary is a discipline for triaging gate output: when an independent-reader gate shows a
residual diff, the instinct to wave it through as "benign / the other side is just better" is the
exact instinct that lets the real bug hide. Treat every residual divergence as a finding to
root-cause.

## Examples

```text
Gate A (parity):   disk_hash == db_hash      ← both from parse() → blind to parse() bugs
Gate C (equiv):    grep(file.tags) == db.tags ← raw text vs parsed → CATCHES parse() bugs
```

Design checklist for a new gate:

- Identify the function under test (`f`). If both sides of your comparison call `f`, the gate
  cannot test `f` — add a side that doesn't (raw bytes/text, a fixture with hand-written
  expectations, a second implementation, or a human).
- Prefer at least one gate per critical `f` whose two sides are independent.
- A residual diff from an independent-reader gate is signal, not noise — root-cause it.

## Exceptions

- A round-trip/parity gate is still worthwhile for catching *drift* (store vs disk diverging over
  time) and serializer faults — just don't mistake it for proof that the shared parser is correct.
- If `f` is itself exhaustively unit-tested against hand-written expectations, the unit tests are
  the independent reader; a downstream parity gate then adds drift coverage on top.

## Related Files

- `scripts/solutions-db/parity-check.ts` — same-parser parity (drift gate; blind to parser bugs)
- `scripts/solutions-db/hook-equivalence-check.ts` — grep-vs-DB (independent reader; caught the bug)

## See Also

- [../logic-errors/zod-array-string-drops-yaml-scalar-tags-2026-06-14.md](../logic-errors/zod-array-string-drops-yaml-scalar-tags-2026-06-14.md) — the parser bug that survived a green parity gate
- [../logic-errors/openai-batch-embeddings-map-by-response-index-2026-06-14.md](../logic-errors/openai-batch-embeddings-map-by-response-index-2026-06-14.md) — another bug no content/parity gate could see
- [hash-normalized-projection-not-bytes-for-regenerated-mirror-2026-06-14.md](hash-normalized-projection-not-bytes-for-regenerated-mirror-2026-06-14.md) — the projection hash both parity sides shared
