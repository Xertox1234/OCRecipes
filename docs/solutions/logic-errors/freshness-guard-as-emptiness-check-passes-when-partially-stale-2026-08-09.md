---
title: A freshness guard implemented as an emptiness check passes for every partially-stale state
track: bug
category: logic-errors
tags: [harness, telemetry, derived-projection, staleness, value-probe, pg-lab]
module: shared
applies_to: ["scripts/pg-lab/**", ".claude/skills/codify/**"]
symptoms: ["A derived projection silently serves results computed over a subset of its source while every check reports normal", "A value probe shows a plausible-but-low hit rate with no way to tell 'nothing to find' from 'searched an incomplete corpus'", "The only staleness signal fires on a zero count — a state the source reaches once, at init, and never again", "Projection row count is stable and non-zero, so nothing looks broken", "The refresh command's only callers in the repo are its own tests"]
severity: medium
created: 2026-08-09
---

# A freshness guard implemented as an emptiness check passes for every partially-stale state

## Problem

A derived projection (cache, index, search table) is rebuilt manually and can drift behind its
source. The design anticipates this and adds a guard — but implements it as a test for the
source being **empty**. Emptiness is a single point at the end of the staleness range. Every
other stale state — 1 row behind, or 153 of 768 — passes the guard and is indistinguishable
from fully fresh at the call site.

## Symptoms

- A projection silently serves results computed over a subset of its source, while every check reports normal.
- A value probe or telemetry ledger shows a plausible-but-low hit rate, with no way to separate "genuinely nothing to find" from "searched an incomplete corpus."
- The only staleness signal in the system fires on a zero count — a state the source reaches once, at initialization, and never again.
- Row count in the projection is stable and non-zero, so nothing looks broken.

## Root Cause

`harness.solution_titles` is the pg_trgm near-dup projection behind `/codify` Step 6b. It is
populated only by a manual `scripts/pg-lab/codify-neardup.sh --rebuild`, and nothing in the
repo ever invokes that — no hook, no cron, no skill step. On 2026-08-09 it held **615 rows
against 768 solution files**, frozen at its last rebuild on 2026-07-09: the 615 were exactly
the files with `created <= 2026-07-09`, and the 153 missing were exactly those created after.
Zero parse failures, zero path drift — pure staleness.

The design did reason about this failure class. A review round on the foundation todo added a
`top_score = NULL` log row for a "reachable but unpopulated" result, specifically so that
*"never rebuilt" is distinguishable from "genuinely zero hits"* for a scheduled prune decision.
That guard is correct and it never fired — because it tests `top_score IS NULL`, which happens
only when the table returns **no rows at all**. A table holding 80% of the corpus returns rows
and logs a normal score. The guard covers one endpoint of a continuous quantity.

The consequence compounds when a **dated keep/prune decision** reads that ledger: all 112
logged invocations ran against the stale snapshot (the first landed 2026-07-10, one day after
the last rebuild), so the probe measured a degraded feature for its entire life. A verdict
drawn from it would be a verdict about the degraded version, and nothing in the ledger says so.

## Solution

Make the guard observe the **difference between source and projection**, not a zero test.
Both quantities are cheap and either one exposes drift:

```sql
-- freshness by extent: newest row in the projection vs newest artifact in the source
SELECT max(created) FROM harness.solution_titles;   -- 2026-07-09 while the corpus had 2026-08-08
```

```bash
# freshness by size: projection row count vs source file count
psql -tA -d "${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}" \
  -c 'SELECT count(*) FROM harness.solution_titles'                                            # 615
find docs/solutions -type f -name '*.md' ! -path '*/_manifests/*' ! -name 'README.md' | wc -l  # 768
```

**But equality is not the test, and treating it as one repeats the original mistake in a new
place.** Three benign causes produce `count(*) < find | wc -l` with no staleness at all: the
extractor emits a row only for a file with a parseable `title:` **and** a non-blank, non-heading
first body line, so one malformed doc silently drops out; the refresh runs from a feature branch,
which may legitimately lack docs merged since it forked; and a linked worktree skips the refresh
by design. Read a mismatch as *inspect*, never as *stale*.

The decisive move is cheaper than the comparison — rebuild from an up-to-date checkout and read
the count it prints, which is ground truth by construction:

```bash
scripts/pg-lab/codify-neardup.sh --rebuild    # prints "✓ rebuilt harness.solution_titles: N rows"
```

Better still, remove the drift rather than instrument it — refresh the projection at the one
place that writes the source. `/codify` Step 7 rebuilds after each codify commit, chained to that
commit so an uncommitted doc is never indexed, and non-blocking so a down lab DB cannot stop a
codify:

```bash
git commit -m "…" && {
  if [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
    "$(git rev-parse --show-toplevel)"/scripts/pg-lab/codify-neardup.sh --rebuild ||
      echo "note: refresh failed — advisory only"
  fi
}
```

Three things that guard has to get right, and all three are easy to get wrong:

**Scope the claim to what the guard actually checks.** It tests checkout *identity*, not corpus
*currency* — so it prevents the destructive case below, but it does not deliver parity with
`main`. Committing to `main` is forbidden here, so this always runs on a feature branch; a branch
forked before a docs merge rebuilds a projection missing those docs. That is bounded and the next
codify from a re-based checkout restores it. State that, or the freshness check above gets read as
a staleness alarm every time it fires.

**Refresh only from the checkout the projection is supposed to mirror.** `--rebuild` derives from
the **checked-out** `docs/solutions` but writes a lab DB **shared by every checkout**. A rebuild
from a worktree therefore replaces the canonical corpus with `(fork-point ∪ that branch)` — and
with 4–5 parallel todo executors it is last-writer-wins, each dropping its siblings' just-committed
docs. That is persistent lag, not drift that self-corrects. Observed directly: rebuilding from a
feature branch produced 766 rows while `main` held 768.

**Do not silence the refresh.** `>/dev/null 2>&1 || true` would swallow psql-missing, the
`LAB_DATABASE_URL` safety refusal, the refuse-to-truncate-on-zero-files guard, and a load failure —
re-creating the exact invisibility this entry documents, one level up. The `✓ rebuilt … N rows`
line **is** the freshness signal; keep it visible and non-blocking rather than silent.

Note `--path-format=absolute`: a bare `git rev-parse --git-dir` returns an absolute path when run
from a subdirectory while `--git-common-dir` stays relative, so the naive string comparison
false-skips in the primary checkout — the guard silently stops guarding what it was written for.

When a probe gates a dated decision, record the corpus size alongside each measurement so a
later reader can tell what was actually searched. A bare score is not self-describing.

## Prevention

- A guard over a continuous quantity (freshness, coverage, completeness) must compare two values. A boolean test covers exactly one point of the range, and it is rarely the point you hit in practice.
- "Unpopulated" and "stale" are different failures. Instrumenting the first is not instrumenting the second, and the second is overwhelmingly more likely — a projection is empty only before its first build.
- Anything described as "only as fresh as the last manual rebuild" has no owner. Grep for callers of the refresh command; if the only hits are its own tests, it will never run again after the day it shipped.
- A value probe with a prune date inherits the validity of whatever it measured. Before acting on it, confirm the feature was healthy for the window the probe covers.
- Check that the replacement check **discriminates**. A comparison with several benign failure modes is no better than the boolean it replaced — it just fires more often. If a mismatch has three innocent explanations, it is a prompt to inspect, not a verdict. Prefer re-deriving the quantity (here: rebuild and read the printed count) over comparing two proxies for it.

## Related Files

- `scripts/pg-lab/codify-neardup.sh` — the advisory; `--rebuild` (loud, human-run) vs query mode (fail-silent)
- `scripts/pg-lab/schema/codify-neardup.sql` — `harness.solution_titles` projection + `harness.codify_neardup_log` value probe
- `.claude/skills/codify/SKILL.md` — Step 6b invokes the advisory; Step 7 now refreshes the projection
- `todos/archive/P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` — the 2026-10-01 prune criterion

## See Also

- [ratio-over-a-column-mixing-two-corpora-measures-neither](ratio-over-a-column-mixing-two-corpora-measures-neither-2026-08-08.md) — sibling measurement trap from the same telemetry surface: a denominator spanning two corpora
- [glob-runner-loop-fails-open-count-and-fail-on-zero](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — the zero-input case this guard did cover, and the reason `--rebuild` refuses to truncate on an empty scan
- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — assert the count, not just the exit code
- [A replay eval cannot use the current corpus as ground truth when the feature under test mutates it](../conventions/replay-eval-ground-truth-mutated-by-the-feature-under-test-2026-08-09.md) — how the cost of this staleness was measured, and the traps in doing so
