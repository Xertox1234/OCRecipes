---
title: "Solution injection ranks within-tier by filename date, not specificity — 51 of 116 harness docs have a matching applies_to glob and are never delivered"
status: backlog
priority: medium
created: 2026-08-13
updated: 2026-08-13
assignee:
labels: [deferred, harness, retrieval]
github_issue:
---

# Solution injection ranks within-tier by filename date, not specificity

## Summary

`inject-patterns.sh` partitions solution candidates into `exact > glob > general` tiers, but
**within** a tier it applies no relevance signal at all — candidates are sorted newest-first by
the `YYYY-MM-DD` in the **filename** and the head is taken. With a mean of **17.4** docs matching
a file's `applies_to` and only **4** slots, 99% of harness files discard most of their genuinely
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
| Docs delivered for ≥1 file in their own domain                   | 41 / 116                  |
| Never delivered for **any** of the 157 files                     | **75 (65%)**              |
| …of those, ones whose `applies_to` **does** match a harness file | **51** — precision wasted |
| Mean docs matching a file, competing for 4 slots                 | **17.4**                  |
| Files where matches exceed the cap                               | **155 / 157 (99%)**       |
| Share of all 644 slot-fills taken by the top 4 docs              | **44%**                   |

Every one of the top-12 most-delivered docs is dated ≥ 2026-07-19. Selection is pure recency.

**The sharpest case.** For `.claude/hooks/test-eslint-fix.sh`, five docs carry the maximally
specific `.claude/hooks/test-*.sh` glob. **None of the five is delivered** — the four winners all
carry broad `.claude/hooks/**/*.sh` globs and merely have newer filenames. One of the five starved
docs is `logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md`, which
describes the exact `grep`-needle footgun that was hit while editing that very file during PR #808.
The corpus held the answer; retrieval could not deliver it.

**Not a contributing factor:** `over = SOLUTIONS_PER_DOMAIN + 4 = 8` is **not** a ranking window.
Per `reserve_bug_slot` (`inject-patterns.sh:50-79`) those 4 spares exist only so a bug-track doc
can be swapped into slot 4 when the natural top-4 has none. The loss is 18 → 4, not 18 → 8 → 4.

## Acceptance Criteria

- [ ] Within-tier ordering uses a **relevance** signal, not creation date alone. Recommended:
      glob specificity via longest literal prefix before the first wildcard
      (`.claude/hooks/test-` = 19 outranks `.claude/hooks/` = 14). Pure string work — no
      filesystem walk, so the hot path pays nothing measurable.
- [ ] Date remains the **tie-break** within equal specificity (preserves today's determinism).
- [ ] Before/after reachability measured for the harness domain and reported in the PR, using the
      method in Implementation Notes. Target: the `starved-with-a-matching-glob` count drops
      materially from its 51 baseline.
- [ ] Verified specifically: editing `.claude/hooks/test-eslint-fix.sh` now delivers at least one
      of its five `.claude/hooks/test-*.sh` docs.
- [ ] At least one other domain measured, to confirm the harness numbers are not idiosyncratic.
- [ ] No regression in `bash .claude/hooks/test-inject-patterns.sh` /
      `test-inject-patterns-relevance.sh`, and the new ordering gets a two-sided test there —
      assert a specific doc IS selected over a newer-but-broader one, and that reverting the
      ordering turns it red (per `gate-test-needs-two-sided-negative-control-2026-07-25.md`).
- [ ] `bash scripts/run-hook-tests.sh` green.

## Implementation Notes

- Ordering is applied at `inject-patterns.sh:244-246` (the `sed`-extracts-filename-date +
  `sort -r`) and consumed by the tier loop at `:280-322`, then `:326-361`. Specificity must be
  computed per **matched pattern**, not per doc: a doc's `applies_to` can hold several globs and
  only the one that matched this file should score it.
- **Cheap secondary win, independently useful:** the sort key is the _filename_ date, i.e.
  `created`. Switching to `last_updated` is one more grep over the tagged set and a strictly
  better staleness proxy — the doc in the example above is `created: 2026-06-27` but
  `last_updated: 2026-08-13`, and sorts as two months stale.
- **Honest limit, measured — do not oversell this fix.** Specificity ranking narrows the competing
  set from 17.4 → **8.3** on average, and only **29%** of files then have a most-specific tier
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
  `grep -rl --include='*.md' --exclude=README.md -E '^tags:.*\b(harness|tooling|pg-lab|worktree|agents)\b' docs/solutions | grep -v /_manifests/`

  Partition starved docs into "has a matching `applies_to` glob" vs "general tier only" — only the
  first group is precision waste; general-tier loss is the designed fallback. **Include a control**
  (docs known to be delivered must test as glob-matching) so a broken matcher cannot report a
  flattering result.

- Glob matching must mirror `:305-312` — bash `[[ ]]` plus the `**/`-elided variant, under
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
