---
title: A replay eval cannot use the current corpus as ground truth when the feature under test mutates that corpus
track: knowledge
category: conventions
tags: [harness, testing, replay-eval, telemetry, measurement, pg-lab]
module: shared
applies_to: ["scripts/pg-lab/**", ".claude/skills/**", "evals/**"]
created: 2026-08-09
---

# A replay eval cannot use the current corpus as ground truth when the feature under test mutates that corpus

## Rule

To measure what a retrieval/advisory feature *would* have found, you replay recorded queries
against the corpus. If the feature's own operation adds to or edits that corpus, today's
corpus is not ground truth for a past query — it contains the consequences of that query.
Reconstruct the corpus as of each query's timestamp, and treat any artifact the feature
touched after the query as contaminated. Report a floor and a ceiling, never a single number.

## Why

Replaying 112 recorded `/codify` near-dup queries against the rebuilt corpus gave **49 hits
above threshold**, against **1** actually observed at the time. Every one of the 48 extra was
an artifact of the corpus having absorbed the query. Two distinct contamination paths, and
they need different guards:

**1. Identity — the candidate became a file.** Every candidate title passed to the advisory was
then written as a solution doc. Scoring candidate against today's corpus matches its own file
at ~1.0. The obvious guard, excluding an exact title match, is far weaker than it looks: the
title is routinely polished between the advisory call and the file write, so identity is fuzzy.
Here it caught only 3 of ~49. The rest scored 0.60–0.90 against files whose names were visibly
the candidate's own — `"a guard outlives the state layout it was written for"` matched
`...outlives-the-state-layout-it-was-written-for-2026-08-04.md`.

**2. Feedback — the feature's success path rewrites the artifact it matched.** This one survives
the obvious fix. On 2026-07-21 the advisory correctly flagged an existing 2026-07-03 doc at
0.472, and the prescribed response (`## 6b` — "prefer extending the existing file over writing
a second one") widened *that doc's title* toward the candidate the same day, in commit
`1b50f0f0`. The same comparison scores 0.513 today. So even "score only against artifacts that
predate the query" is contaminated: a pre-existing artifact is not immutable when the feature's
whole purpose is to cause edits to it.

The corrected floor — score only against docs created **strictly before** the query day —
returned exactly 1 hit, matching what was observed. That agreement is what makes the null
result trustworthy: staleness had cost zero detections, and the naive 49 would have argued
loudly for the opposite conclusion.

## Smell patterns

- The replayed inputs and the corpus rows have a one-to-one relationship — every query eventually became a row.
- Replay hit rate exceeds the observed hit rate by an order of magnitude. That gap is the artifact, not the finding.
- Scores cluster near 1.0. Genuine near-dups in a corpus of deliberately distinctive titles sit far lower — the best real cross-doc pair here scored 0.472.
- The best match's creation date equals the query date.
- The feature's documented success behavior includes editing or merging existing corpus entries.

## Examples

Reconstruct the corpus at query time, and exclude the query's own output:

```sql
-- CEILING: same-day siblings included (the highest-prior-probability genuine dup case),
-- but still exposed to both contamination paths. Upper bound only.
SELECT max(similarity(st.title, l.candidate))
FROM harness.solution_titles st
WHERE st.created <= l.ts::date        -- corpus as it existed when the query ran
  AND st.title <> l.candidate;        -- weak: only catches an unedited title
```

```sql
-- FLOOR: strictly pre-existing docs. Immune to path 1 by construction; drops genuine
-- same-day siblings, so it under-counts. The truth lies between floor and ceiling.
SELECT max(similarity(st.title, l.candidate))
FROM harness.solution_titles st
WHERE st.created < l.ts::date;
```

Best of all, measure on a quantity the feature cannot write. Comparing distinct *files* to each
other cannot self-match, because two different rows are two different artifacts:

```sql
-- Corpus-wide near-dup census — no replay, no candidates, no contamination.
SELECT count(*) FROM harness.solution_titles a
JOIN harness.solution_titles b ON a.path < b.path
WHERE similarity(a.title, b.title) >= 0.45;
--> 10 pairs across the whole corpus, all from the May/June bulk-import era, none
--> involving any of the 153 docs the stale projection had been unable to see.
```

That third query is what actually settled the question. It confirmed independently that the
invisible docs contained nothing to find, so the null result was a property of the corpus and
not of the replay method.

## Exceptions

Replaying against the live corpus is fine when the feature is genuinely read-only with respect
to it — a ranking change over a corpus written by an unrelated process, for instance. The trap
is specific to features whose output feeds back into their own input. Check before assuming:
"does running this feature ever cause a row to be added or edited here?"

Note this applies directly to any future injection-ranking replay eval
(`docs/superpowers/specs/2026-07-16-pg-injection-ranking-layer-design.md`, N=200 stratified
replay): sessions being replayed are themselves sessions that codified new solution docs into
the corpus the ranker selects from.

## Related Files

- `scripts/pg-lab/codify-neardup.sh` — the advisory being measured
- `scripts/pg-lab/schema/codify-neardup.sql` — `harness.codify_neardup_log`, the recorded-query ledger a replay reads
- `.claude/skills/codify/SKILL.md` — Step 6b "prefer extending the existing file", the behavior that creates contamination path 2

## See Also

- [Piping a hook-proxied command filters the PROXY's rewritten output](piped-proxied-command-filters-rewritten-output-2026-08-08.md) — same lesson class: verify against a surface the tooling has not already transformed
- [A freshness guard implemented as an emptiness check passes for every partially-stale state](../logic-errors/freshness-guard-as-emptiness-check-passes-when-partially-stale-2026-08-09.md) — the staleness this replay was built to measure
- [A comparison over a LOSSY projection of the value reports a false match](../logic-errors/comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md) — comparing the wrong representation of a thing
- [A multi-metric stability claim checked for one metric](../logic-errors/multi-metric-stability-claim-checked-for-one-metric-2026-07-16.md) — the neighbouring habit of over-generalizing from a single verified number
