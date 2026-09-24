---
title: A pipeline that truncates before it ranks silently discards its best candidates
track: bug
category: logic-errors
module: shared
severity: high
tags: [retrieval, ranking, inject-patterns, harness, tooling, pagination, silent-failure, relevance]
applies_to: [.claude/hooks/inject-patterns.sh, .claude/hooks/**/*.sh, scripts/**/*.ts, server/services/**/*.ts, server/storage/**/*.ts]
symptoms: [A relevance/priority field exists and is documented as live, but changing it has no observable effect, A "top N" list is dominated by whatever is newest rather than whatever fits, A corpus/index grows steadily while the set actually served stays the same size, Docs cite records by name that the system can never surface]
created: '2026-08-06'
last_updated: '2026-09-24'
---

# A pipeline that truncates before it ranks silently discards its best candidates

## Problem

`solutions_from_markdown` in `.claude/hooks/inject-patterns.sh` selected solution files for a
domain like this:

```bash
grep -rl "^tags:.*$tag" "$SOLUTIONS_DIR" \
  | sort -r                       # by the YYYY-MM-DD in the filename, newest first
  | head -n 8                     # <-- CAP
# ...only now partition the survivors by whether their applies_to globs match the edited file
```

The `applies_to` relevance field was consulted **after** the cap. A solution whose globs matched
the edited file exactly, but which ranked #40 by date, was discarded before anything looked at
whether it was relevant. `docs/solutions/README.md` documented `applies_to` as live; it was live
only within an eight-item date window.

## Symptoms

- Only **170 of 735** corpus solutions were ever injected across a month and 139 sessions
  (measured from `harness.injection_log`).
- **16 of the 23** solutions that `docs/rules/*.md` cites BY NAME could not be delivered for any
  file in their own domain — the rules files pointed at deep-dives the injector could never surface.
- A Drizzle storage edit was served hook-safety and command-gate post-mortems, purely because
  those were the most recently codified files carrying a matching tag.
- Editing `applies_to` on an older file changed nothing, so the field looked broken or ignored.

## Root Cause

Two correct operations in the wrong order. `sort -r` sorts correctly. `head -n 8` truncates
correctly. The partition-by-relevance loop partitions correctly. Every function is right in
isolation; the defect is only visible in their sequence, which is why it survives code review —
no single line looks wrong.

Generalised: **if a stage discards candidates by a cheap proxy (recency, insertion order, id)
before the stage that scores them by the real criterion, the real criterion can only ever reorder
the survivors.** The system will look like it ranks by relevance and will actually rank by the
proxy.

## Solution

Rank first, cap last. Partition the **full** candidate set into tiers, then take the cap from the
concatenation:

```bash
# exact path match > glob match > everything else; newest-first WITHIN each tier
tagged=$(grep -rl "^tags:.*$tag" "$SOLUTIONS_DIR" | sort -r)   # no cap here
# ...classify every entry, build $exact / $glob / $general...
printf '%s%s%s' "$exact" "$glob" "$general" | head -n "$over"   # cap only at the end
```

Measured on 39 sampled source files: distinct solutions surfaced went **40 → 54 (+35%)**, with 22
newly reachable. The 8 displaced were harness/meta solutions appearing on app code purely by
recency.

Cost changes from O(cap) to O(candidate set), so pay for it: one batched
`grep -H -m1 '^applies_to:'` over the whole tagged set replaced a per-file `grep` plus a
five-process pipeline, which kept it within noise of the original.

## Prevention

- When a `head`/`LIMIT`/`slice` and a scoring step appear in the same function, check their order
  explicitly. Write the question down: *"can the scorer see a candidate the cap already dropped?"*
- Treat "this relevance field has no observable effect" as a sequencing symptom, not a matching bug.
- Pin it with a test whose fixture is deliberately **outside** the cap window — e.g. nine newer
  general entries plus one exact match dated years earlier, asserting the exact match is delivered.
  A fixture that fits inside the window cannot fail.
- Honest scope: this removes a hard exclusion; it does not make ranking fine-grained. 47
  accessibility solutions match `client/screens/**/*.tsx`, so within a heavily-matched domain the
  tier still collapses to date order internally.

### The residual landed too (added 2026-08-16)

The "tier still collapses to date order internally" residual above is now fixed one level
down: the glob tier is ranked by `applies_to` specificity (longest literal prefix before the
first wildcard), date remaining the tie-break. Measured on the harness domain: reachable docs
+27–30%, starved-with-a-matching-glob −17–20%. Still bimodal, not uniform — a domain where
every glob shares the same prefix shape (react-native's `client/components/**/*.tsx`) sees a
much smaller delta, confirming rather than contradicting the honest-scope note above; see
`injection-glob-tier-ranked-by-date-not-specificity-2026-08-13` in `todos/archive/`.

### A second instance: `MAX_FINDINGS_PER_TOOL` capping file-length findings (added 2026-09-24)

`scripts/audit-scanners.ts`'s `capFindings` sorts every tool's findings by `severity` before
slicing to `MAX_FINDINGS_PER_TOOL` (20) — the correct proxy for `npm-audit`/`gitleaks`, where
severity varies. But `sweepFileLengths` gave every file-length finding the same `"Low"` severity,
so `capFindings`'s sort was a no-op tie for that tool and the kept 20 were whatever order
`git ls-files` happened to enumerate (alphabetical-ish) — the real criterion for this tool (line
count) was never consulted before the cap discarded 24 of 44 candidates. A 2026-09-23 audit found
a 1700-line and a 1267-line file silently absent from a 20-of-44 scanner run while smaller files
under 700 lines were kept, purely by alphabetical luck.

Same root cause as above, same fix shape: rank first, cap last — but here "rank" means sorting by
the tool's own real criterion (`lines` descending) inside `sweepFileLengths`, upstream of
`capFindings`'s generic severity sort, so the two compose correctly (severity ties preserve
insertion order, and insertion order is now biggest-first). Also added: `capFindings` now returns
the dropped `hidden` findings (not just a count), and the CLI prints a `hidden by cap: <files>,
+N more` line, so a future silent truncation is visible in the tool's own output rather than
requiring an audit to notice via a missing-file complaint. Pinned by a composed test
(`scripts/__tests__/audit-scanners.test.ts`) asserting `capFindings(sweepFileLengths(entries))`
against an independently-sorted expected top-20, with sizes shuffled relative to file names so an
insertion/alphabetical-order regression can't pass by coincidence — the isolated per-function
tests for each stage stayed green even when only one stage was fixed, exactly the "every function
is right in isolation" trap this solution describes.

## Related Files

- `.claude/hooks/inject-patterns.sh` — `solutions_from_markdown`
- `.claude/hooks/test-inject-patterns-relevance.sh` — the out-of-window fixture that pins it
- `scripts/audit-scanners.ts` — `sweepFileLengths`, `capFindings`
- `scripts/__tests__/audit-scanners.test.ts` — the composed rank-then-cap regression test

## See Also

- [mirror inject-patterns applies_to matching](../conventions/mirror-inject-patterns-applies-to-with-bash-glob-not-globstar-2026-06-13.md) — the glob half of the same defect
- [tags and applies_to are a two-part routing precondition](../conventions/tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — why a correct glob can still be inert
