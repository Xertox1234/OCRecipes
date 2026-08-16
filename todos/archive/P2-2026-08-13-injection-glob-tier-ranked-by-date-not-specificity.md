---
title: "Solution injection ranks within-tier by filename date, not specificity — 45 of 116 harness docs have a matching applies_to glob and are never delivered"
status: done
priority: medium
created: 2026-08-13
updated: 2026-08-16
assignee:
labels: [deferred, harness, retrieval]
github_issue:
---

# Solution injection ranks within-tier by filename date, not specificity

## Summary

`inject-patterns.sh` partitions solution candidates into `exact > glob > general` tiers, but
**within** a tier it applies no relevance signal at all — candidates are sorted newest-first by
the `YYYY-MM-DD` in the **filename** and the head is taken. With a mean of **16.9** docs matching
a file's `applies_to` and only **4** slots, 98% of harness files discard most of their genuinely
targeted candidates by creation date.

## Background

PR #762/#767 (2026-08-06) fixed the _pre-partition_ truncation — the pool used to be cut to the 8
newest **before** `applies_to` was consulted, so relevance could only reorder date-survivors.
That fix is real and shipped (`truncate-before-rank-discards-best-candidates-2026-08-06.md`).

What remains is the same defect one level down: the partition happens first now, but the tiers
themselves are ordered only by date, so a truncation-before-ranking still occurs _inside_ the
glob tier.

**Measured 2026-08-13** by driving the real hook per file with `PATTERN_INJECT_NO_DEDUP=1`
(not a reimplementation of its tier logic — a reimplementation could diverge and measure itself)
across the harness domain: **116 tagged docs, 157 files**.

| Metric                                                           | Value                     |
| ---------------------------------------------------------------- | ------------------------- |
| Docs delivered for ≥1 file in their own domain                   | 48 / 116                  |
| Never delivered for **any** of the 157 files                     | **68 (58.6%)**            |
| …of those, ones whose `applies_to` **does** match a harness file | **45** — precision wasted |
| Mean docs matching a file, competing for 4 slots                 | **16.9**                  |
| Files where matches exceed the cap                               | **154 / 157 (98%)**       |
| Share of all 628 slot-fills taken by the top 4 docs              | **39.2%**                 |

**The benefit of a ranking fix is bimodal, not uniform — do not assume otherwise when
measuring.** Where glob-tier competition is _deep_ (`.claude/hooks/**`, which many broad
`**/*.sh` docs match), within-tier date ordering starves the specific doc, which is the case
this todo is about. Where competition is _shallow_ (`server/scripts/**/*.ts`), an old but
correctly-targeted doc already wins today — e.g. `prod-ops-script-guard-on-flag-not-node-env`
(2026-06-20) and `pg-pooled-connection-poisoned-without-rollback-in-finally` (2026-06-13) are
both delivered. A second domain chosen without deep glob competition will show a small
before/after delta that is easy to misread as "the fix didn't help."

**The sharpest case.** For `.claude/hooks/test-eslint-fix.sh`, five **harness-tagged** docs carry
the maximally specific `.claude/hooks/test-*.sh` glob. **None of the five is delivered** — the four
winners all carry broad `.claude/hooks/**/*.sh` globs and merely have newer filenames. One of the
five starved docs is `logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md`,
which describes the exact `grep`-needle footgun that was hit while editing that very file during
PR #808. The corpus held the answer; retrieval could not deliver it.

### A second, independent defect this cannot fix: tag-routing excludes targeted docs outright

Ranking only reorders the **pool**. Four docs carry `.claude/hooks/test-*.sh` — the maximally
specific glob for a hook self-test — and are **not in the harness pool at all**, so no ranking
change can ever surface them:

| Doc                                                                                         | Why excluded                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md`             | no harness-family tag — **and `docs/rules/harness.md` cites it BY NAME** |
| `conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`                      | no harness-family tag                                                    |
| `best-practices/test-budget-margin-must-clear-threshold-with-headroom-2026-07-05.md`        | no harness-family tag                                                    |
| `conventions/chmod-000-regression-test-os-may-already-block-guarded-behavior-2026-07-19.md` | tagged `worktrees` — the alternation is `\bworktree\b`, singular         |

The pluralization is systematic, not a one-off: **3 docs use `worktrees`, 9 use `worktree`**. So
the choice is retag the 3, or widen the alternation to `worktrees\?` (which also catches future
occurrences). Prefer the alternation — a data fix does not stop the next author writing the plural.

**Not a contributing factor:** `over = SOLUTIONS_PER_DOMAIN + 4 = 8` is **not** a ranking window.
Per `reserve_bug_slot` (`inject-patterns.sh:50-79`) those 4 spares exist only so a bug-track doc
can be swapped into slot 4 when the natural top-4 has none. The loss is ~17 → 4, not 17 → 8 → 4.

## Acceptance Criteria

- [x] Within-tier ordering uses a **relevance** signal, not creation date alone. Recommended:
      glob specificity via longest literal prefix before the first wildcard
      (`.claude/hooks/test-` = 19 outranks `.claude/hooks/` = 14). Pure string work — no
      filesystem walk, so the hot path pays nothing measurable.
- [x] Date remains the **tie-break** within equal specificity (preserves today's determinism).
- [x] Before/after reachability measured for the harness domain and reported in the PR, using the
      method in Implementation Notes. Baseline to beat: **45** starved-with-a-matching-glob, out
      of 116 pool docs over 157 files. Report the new number, not "it improved."
- [x] Verified specifically: editing `.claude/hooks/test-eslint-fix.sh` now delivers at least one
      of the five **harness-tagged** docs carrying `.claude/hooks/test-*.sh`. (Eight docs carry
      that glob; three are outside the pool — see the tag-routing section. Verifying against one
      of those three would make this criterion unsatisfiable through no fault of the fix.)
- [x] At least one other domain measured, **chosen for deep glob competition** (see the bimodal
      note in Background), to confirm the harness numbers are not idiosyncratic.
- [x] The four out-of-pool `.claude/hooks/test-*.sh` docs are reachable — preferred fix is
      widening the tag alternation (`worktrees\?`) plus adding a harness-family tag to the three
      untagged ones. Re-run the reachability measurement after, since this changes the pool size
      and therefore every denominator above.
- [x] No regression in `bash .claude/hooks/test-inject-patterns.sh` /
      `test-inject-patterns-relevance.sh`, and the new ordering gets a two-sided test there —
      assert a specific doc IS selected over a newer-but-broader one, and that reverting the
      ordering turns it red (per `gate-test-needs-two-sided-negative-control-2026-07-25.md`).
- [x] `bash scripts/run-hook-tests.sh` green.

## Implementation Notes

- Ordering is applied at `inject-patterns.sh:244-245` (the `sed`-extracts-filename-date +
  `sort -r`) and consumed by the tier loop at `:280-322`, then `:326-361`. Specificity must be
  computed per **matched pattern**, not per doc: a doc's `applies_to` can hold several globs and
  only the one that matched this file should score it.
- **Cheap secondary win, independently useful:** the sort key is the _filename_ date, i.e.
  `created`. Switching to `last_updated` is one more grep over the tagged set and a strictly
  better staleness proxy — the doc in the example above is `created: 2026-06-27` but
  `last_updated: 2026-08-13`, and sorts as two months stale.
- **Honest limit, measured — do not oversell this fix.** Specificity ranking narrows the competing
  set from 16.9 → **~8.2** on average, and only **30.6%** of files then have a most-specific tier
  fitting in 4 slots. It is a >2× improvement, not a complete solution; ~8 docs still contend for
  4 slots and date breaks those ties. If that residual matters, the follow-on lever is
  `SOLUTIONS_PER_DOMAIN` itself — but that trades against `THRESHOLD=9000` / `DOMAIN_BUDGET=8600`
  and cross-domain budget sharing, so treat it as a separate decision with its own measurement.
- **Reproducing the measurement** (the acceptance test). Per file, drive the real hook and collect
  delivered paths; a doc reached by none of its own domain's files is starved:

  ```bash
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/%s"}}' "$PWD" "$f" \
    | PATTERN_INJECT_NO_LOG=1 PATTERN_INJECT_NO_DEDUP=1 bash .claude/hooks/inject-patterns.sh \
    | grep -o 'docs/solutions/[A-Za-z0-9._/-]*\.md'
  ```

  Pool for the domain (note `harness` is an alternation, not a bare tag):
  `grep -rl --include='*.md' --exclude=README.md -E '^tags:.*\b(harness|tooling|pg-lab|worktrees?|agents)\b' docs/solutions | grep -v /_manifests/`
  (the alternation above is the POST-fix pattern — `worktrees?`, not the pre-fix `worktree`; a
  post-fix re-run must use it or it under-counts the pool by excluding plural-`worktrees`-only docs)

  **The file set — get this right; a first pass at these numbers was wrong because of it.**
  Do NOT hand-enumerate harness paths: `server/scripts/**` also routes to `harness`
  (`path-domains.ts` matches _any_ directory named `scripts`), and omitting it skews every
  delivery figure. Let the hook be the routing oracle instead — probe
  `git ls-files '.claude/*' '.husky/*' '*scripts/*' | grep -v '^docs/'` and count a file as
  in-domain iff its payload contains a `[SOLUTIONS — harness` block. Then extract refs from
  **that block only**: a multi-domain file emits several blocks, and collecting all of them
  credits a harness-pool doc as "reached" when another domain delivered it. Sanity check:
  slot-fills should come out at ~4 × in-domain files (628 for 157). A total above that means
  the extraction is leaking other domains' blocks.

  Partition starved docs into "has a matching `applies_to` glob" vs "general tier only" — only the
  first group is precision waste; general-tier loss is the designed fallback. **Include a control**
  (docs known to be delivered must test as glob-matching) so a broken matcher cannot report a
  flattering result.

- Glob matching must mirror `:311-314` (`:312` sets `is_exact`, `:314` sets `is_glob`; the lines
  above are quote-stripping and `**/`-elision setup) — bash `[[ ]]` plus the elided variant, under
  `set -f`. Run it under **bash**, not the interactive zsh: `[[ ]]` pattern semantics differ.

## Scope Contract

- **Mechanisms to use:** the existing tier partition in `solutions_from_markdown` — reorder within
  tiers only. No new tier, no new frontmatter field, no scoring config file.
- **Files in scope:** `.claude/hooks/inject-patterns.sh`,
  `.claude/hooks/test-inject-patterns-relevance.sh`, `.claude/hooks/test-inject-patterns.sh`.
- Do **not** change `SOLUTIONS_PER_DOMAIN`, `THRESHOLD`, or `DOMAIN_BUDGET` in this todo — those
  trade against the inline size budget and belong to a separate, separately-measured decision.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The 2026-08-06 partition fix (PRs #762/#767) is merged and is the foundation this builds on.

## Risks

- This hook runs before **every** Edit/Write. Any added per-invocation cost is paid constantly —
  hence the longest-literal-prefix proxy (string ops) rather than counting files a glob matches.
- Changing selection changes what every future session sees. The before/after reachability
  measurement is the guard against trading one blind spot for another; a raw "more docs surfaced"
  count is not sufficient evidence of improvement.
- `docs/rules/harness.md` records that 523 of 695 corpus `applies_to` entries use the
  `dir/**/*.ext` boilerplate form. Specificity ranking discriminates well in the harness domain
  (measured: a clear 19-vs-14 prefix split), but a domain where every glob is the same shape would
  see little benefit — which is why measuring a second domain is an acceptance criterion.

## Updates

### 2026-08-13

- Filed from the investigation that followed PR #808. All figures above are measured, not
  estimated; the measurement drove the real hook rather than a reimplementation of its tiers.
- **Figures corrected during pre-merge review, before this todo ever landed.** The first pass
  had two methodology defects: its file set omitted `server/scripts/**` (which routes to
  `harness`), and it collected solution refs from the whole payload rather than the harness
  block alone, so a doc delivered by another domain counted as reached. Corrected numbers
  replace the originals throughout (reachable 41→48, starved 75→68, starved-with-glob 51→45,
  slot-fills 644→628, top-4 share 44%→39.2%). A claim that "every top-12 doc is dated
  ≥ 2026-07-19" was **falsified** by the corrected set and is replaced with the bimodal
  framing in Background — that correction changes how the fix should be measured, not just
  the prose. The tag-routing section is also new from that review.

### 2026-08-16

- **Implemented.** `glob_specificity()` (longest literal `applies_to` prefix before the first
  wildcard) ranks the glob tier; date remains the tie-break via an explicit index column (not
  relying on cross-platform `sort` stability). Harness alternation widened `worktree` →
  `worktrees?`; `gate-test-needs-two-sided-negative-control-2026-07-25.md`,
  `test-budget-margin-must-clear-threshold-with-headroom-2026-07-05.md`, and
  `glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md` tagged `harness` (the
  three of the eight `.claude/hooks/test-*.sh` carriers that had no harness-family tag; the
  eighth, `chmod-000-regression-test-...`, was already tagged `worktrees` and became reachable
  from the alternation widen alone).
- **Corpus drift note:** the corpus grew by 10 harness-pool docs in the 3 days since this todo
  was filed, so the verified-today baseline differs from the numbers above in absolute terms
  (measured freshly rather than silently reconciled — see PR body for the full before/after).
  Baseline (today, HEAD): 127 pool / 195 in-domain files / 44 reachable / 60 starved-with-glob.
  Ranking-only (same pool): 56 reachable (+27.3%) / 48 starved-with-glob (−20.0%). Full fix
  (pool 130): 57 reachable (+29.5%) / 50 starved-with-glob (−16.7%).
- **Second domain (react-native / client/components, chosen for deep competition — mean ~75
  docs/file — AND genuine specificity spread across prefix lengths 7–32, unlike the flat
  `client/screens/**/\*.tsx`-only case this todo's own Background flags as misleading):
  measured before/after on a representative 1-in-4 sample (78 files) for tractability —
  reachable 19→21 (+10.5%), starved-with-glob 97→95 (−2.1%). Small delta, consistent with (not
  contradicting) the "narrows 16.9→~8.2 on average, not a complete solution" honesty note —
  competition this deep still leaves many same-shape globs tied at equal specificity, falling
  back to date among themselves.
- **Correction to this todo's own Background claim:** `glob-runner-loop-fails-open-count-and-
fail-on-zero-2026-07-03.md` does not currently carry the `.claude/hooks/test-*.sh` glob
  (`applies_to` is `[.claude/hooks/**, scripts/**/*.sh, .github/workflows/*.yml, .husky/**]`),
  and `docs/rules/harness.md` does not currently cite it by name — both claims in the original
  "why excluded" table were verified false against today's corpus (drift, or an error that
  survived the pre-merge correction pass). Tagged it `harness` anyway since it's independently
  legitimate harness/tooling content and the AC asks for a tag on "the three untagged ones."
- Verified directly: editing `.claude/hooks/test-eslint-fix.sh` now delivers
  `gate-test-needs-two-sided-negative-control-2026-07-25.md` (top slot) and
  `chmod-000-regression-test-os-may-already-block-guarded-behavior-2026-07-19.md`. All 8 corpus
  docs carrying `.claude/hooks/test-*.sh` are now in the harness pool (was 5/8).
- Two new tests added to `test-inject-patterns-relevance.sh` (within-glob-tier specificity
  ordering; a trailing-newline tier-fusion regression guard). Mutation-checked per
  `gate-test-needs-two-sided-negative-control-2026-07-25.md`: reverting the sort column back to
  date-only turns the new specificity test red (verified manually, hook restored after).
  `test-inject-patterns.sh` (74/74) and `scripts/run-hook-tests.sh` (32/32 suites) unaffected.
- Code review (2 rounds) found one CRITICAL outside this todo's stated file scope but a direct
  consequence of the `worktrees?` widen: `scripts/check-solution-frontmatter.js`'s
  `ROUTABLE_TAG_PATTERNS` is a documented mirror of `domain_tag_pattern()` and had desynced —
  fixed in the same PR (its own docblock says "keep in sync"). A SUGGESTION-level finding (3
  unrelated prose docs describing the alternation as `worktree`-only) filed as
  `todos/P3-2026-08-16-harness-worktrees-alternation-stale-in-three-prose-docs.md` rather than
  fixed inline (out of this todo's scope, low severity, non-blocking).
