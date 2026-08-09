---
title: "A coverage ratio whose numerator and denominator come from different populations measures neither"
track: bug
category: logic-errors
tags: [telemetry, metrics, measurement, denominator, coverage, postgres, harness, injection-log]
module: shared
applies_to: ["scripts/pg-lab/**", "scripts/lib/**/*.ts"]
symptoms: ["A coverage or utilization percentage looks plausible but is quietly inflated", "The numerator is a DISTINCT count over a column that holds more than one kind of thing", "The denominator is a file/row count scoped to only one of those kinds", "Two snapshots of the 'same' metric disagree and neither states its basis"]
severity: medium
created: 2026-08-08
---

# A coverage ratio whose numerator and denominator come from different populations measures neither

## Problem

A "how much of our corpus actually gets used" statistic was computed as:

```sql
-- numerator: distinct docs ever delivered
SELECT count(DISTINCT d) FROM harness.injection_log, unnest(doc_paths) AS d;  -- 222
```

divided by a denominator counted on disk:

```bash
find docs/solutions -name '*.md' -not -path '*_manifests*' | wc -l           # 767
```

`222 / 767 = 28.9%` is wrong. `injection_log.doc_paths` carries **both** corpora the
pattern-injection hook delivers — `docs/rules/<domain>.md` **and** `docs/solutions/**`. The
numerator counted 208 solutions **plus 14 rules files**; the denominator counted solutions
only. The correct figure is `208 / 767 = 27.1%`.

The absolute error was small, but the shape of the mistake is not: the two sides of the
division were drawn from different populations, so the quotient describes no real quantity.

## Symptoms

- A coverage/utilization percentage that no one can reproduce from first principles.
- The numerator comes from a log column, the denominator from the filesystem or a table — two
  sources that were never checked for the same membership rule.
- The column feeding the numerator is an array or free-text path that holds heterogeneous
  entries (`docs/rules/*` and `docs/solutions/*`, internal and external IDs, test and prod rows).
- A later recomputation of "the same" metric disagrees with the earlier one, and neither
  recorded how it was scoped.

## Root Cause

`doc_paths` is a single `text[]` serving two corpora with completely different lifecycles and
cardinalities: ~14 rules files that fire on nearly every hook invocation, and ~767 solution
docs that fire rarely. Any aggregate over the raw column silently blends them. Because the
rules files fire constantly, they are guaranteed to appear in the DISTINCT set, so they inflate
every "docs delivered" count by a fixed +14 — small enough to look reasonable, large enough to
be wrong.

The denominator, meanwhile, was written with an explicit membership rule
(`docs/solutions`, minus `_manifests`). The numerator had none.

## Solution

Filter the numerator to the same population the denominator describes, and prove the two sides
share a basis before dividing:

```sql
-- Scope the numerator explicitly. Never take a bare DISTINCT over a mixed column.
SELECT count(DISTINCT d) FILTER (WHERE d LIKE 'docs/solutions/%') AS solutions_only,
       count(DISTINCT d) FILTER (WHERE d LIKE 'docs/rules/%')     AS rules,
       count(DISTINCT d)                                          AS all_paths
FROM harness.injection_log, unnest(doc_paths) AS d;
--  solutions_only | rules | all_paths
--             208 |    14 |       222
```

Then check the other half of the subtraction — that every path in the numerator still exists in
the denominator's population (a log accumulates paths for docs since renamed or deleted, which
would make `767 - 208` meaningless in the other direction):

```bash
# all 208 delivered solution paths must still resolve on disk
while read -r p; do [ -f "$p" ] || echo "MISSING: $p"; done < delivered.txt
```

State the basis in the artifact itself, next to the number, so the next reader can audit it
without re-deriving the query.

## Prevention

- Before dividing, say out loud what population each side counts. If the two sentences are not
  identical, the quotient is not a rate.
- Treat any array/path column as heterogeneous until proven otherwise — `SELECT DISTINCT` over
  it is a question about the column's schema, not a measurement.
- Break the count out by class (`FILTER (WHERE ...)` per prefix) rather than taking a total.
  The breakdown is the evidence that the filter was needed at all; the total hides it.
- Verify both directions of a set subtraction: everything counted still exists, and everything
  existing is countable.
- When a metric is recorded in a durable document, record its scoping rule with it. A number
  without its basis cannot be compared against a later recomputation — which is how two
  snapshots of "the same" statistic end up disagreeing with no way to tell which was right.

## Related Files

- `.claude/hooks/inject-patterns.sh` — the producer that writes both rules and solution paths
  into the same `doc_paths` array
- `scripts/lib/path-domains.ts` — the path → domain mapping the hook derives from
- `todos/archive/P3-2026-07-05-pg-injection-ranking-layer.md` — the analysis where this was
  caught, and which states the basis inline (closed DROP 2026-08-09, hence the archive path)

## See Also

- [A cross-field invariant that holds under ONE regulatory regime is not an invariant on a mixed-provenance corpus](regime-dependent-invariant-breaks-on-mixed-provenance-data-2026-08-05.md) — the same "one population or two?" question, applied to validation rules instead of ratios
- [A comparison over a LOSSY projection of the value reports a false match](comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md) — sibling failure: the operands were reduced before being compared
- [A verification that scans ZERO inputs is green and meaningless — assert the count, not just the exit code](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the degenerate case of an unexamined denominator
- [A confidence score that counts inferences gates itself — count evidence, not conclusions](confidence-must-count-evidence-not-inferences-2026-08-05.md) — another metric whose inputs were the wrong population
