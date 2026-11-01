---
title: 'A guard or keyword-regex change needs a base-vs-head verdict comparison over a generated set before review — the fix chains were each a form the first PR never varied'
track: knowledge
category: best-practices
module: harness
tags: [harness, hooks, testing, nutrition]
applies_to: [.claude/hooks/*.sh, .claude/hooks/lib/*, shared/constants/diet-conflicts.ts, shared/constants/allergens.ts]
created: '2026-11-01'
---

# Guard and keyword changes need a base-vs-head verdict comparison

Harness diagnosis N7. In 10-10 → 10-30, four changes to command guards and keyword regexes each
needed one or two follow-up PRs: 1552→1553→1554 (worktree guard), 1476→1478→1479 (dependency nudge),
1545→1548 (outward-CLI guard), 1491→1499 (diet keywords). Every follow-up fixed a form the first PR's
tests never varied. The follow-ups did run generated sets (672 and 612 rows), but only after review
found the gap, and the generators were never committed.

## Two kinds of miss, two lists

- **A case the old version handled, broken by the new one** (1545→1548, 1552→1553, 1478→1479). Run
  both versions over the same generated rows and list every verdict that changed.
- **A rule that is new, so there is no old verdict to change** (1476→1478, 1491→1499). "meat" was a
  new keyword in #1491, so "meat free-range" flagged nothing at base and nothing at head: a diff
  shows nothing. Only listing rows that contain the new keyword and still flag nothing shows it.

A third list covers what neither catches: a gap that was open at both commits on a seed the change
is working on (1553→1554: the brace-built `{-..-}-output`).

## The tool

`bash scripts/harness/verdict-diff.sh [--base <ref>] [--head <ref>]` (default base: merge-base with
`origin/main`). The registry `scripts/harness/verdict-diff/targets.tsv` lists the files it covers.

- **Guards:** `seeds/<hook>.tsv` must-trigger (T) and must-not (N) commands × variation kinds taken
  from the chains: spacing and tabs, `sudo`/`time`/`env`/`command`/`nohup`, `{ …; }` and `( … )`,
  prefixes (`true;`, `false ||`, newline), a leading `cd` into a missing or unenterable folder
  before each separator, quoting the verb, brace-spelled options, an option moved before the verb,
  interpreter redefinition. Lines marked `!` are variations that change the command's meaning.
- **Keywords:** each module's own keywords (read from source text) × food modifiers × position.
  Rows for a keyword new at head are counted, not listed, under CHANGED and judged under GAPS.
- **Controls, required for the stamp:** every T seed (or bare keyword) triggers at head through the
  same worker path; a re-run of a sample of head rows agrees; rows evaluated = rows generated.

`.claude/hooks/pr-preflight-guard.sh` refuses a PR whose changes touch a registry path until
`<stamp dir>/<head sha>` exists (`scripts/lib/verdict-diff-stamp-path.sh`). Bypass:
`SKIP_VERDICT_DIFF=1` in Claude Code's launch environment. Author-run; never in CI. Measured: keywords 1–2 s, one guard 4–52 s, a `lib/` change (all three guards) 105 s.

## Measured: the tool over the six chain commits (2026-11-01)

| Run (base → head)  | Showed                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| 1545^ → 1545       | CHANGED: `python3 ( ) {…}`, `hash -p /bin/sh python3`, `enable -n` (and node) DENY→ALLOW — #1548's fix |
| 1552^ → 1552       | CHANGED: `cd <missing> && : \|\| git commit` DENY→ALLOW; control: `git stash list --output <main>/x` silent — #1553's two fixes |
| 1553^ → 1553       | STILL OPEN: `git stash list {-..-}-output …` — the first of #1554's two fixes. **Not reproduced:** the unenterable-`cd` half (the fixture's unenterable folder is a plain temp folder, which git-safety already denies; the real case likely needs the trusted worktree itself to be unenterable) |
| 1476^ → 1476 (new) | GAPS: double space, tab, `sudo`, `time`, `{ …; }` — #1478's list                            |
| 1478^ → 1478       | CHANGED `!`: `npm -g install typescript` ALLOW→FIRE — #1479's fix                          |
| 1491^ → 1491       | GAPS: "meat free-range", "plant-based meat", "vegan meat" — #1499's fix plus two more      |

The variation kinds were chosen knowing these answers, so this shows the tool surfaces a defect once
its kind is listed, not that it would find a new kind. The 2,160-row outward-CLI corpus still let
#1548 through. When a new chain happens, add the kind of variation it exposed.

The same runs also found pre-existing gaps, recorded rather than fixed: git-safety's contract check
is silent on `sudo`/`env`/`command`-wrapped, brace-grouped and quoted `git` (docs/harness-residuals.md),
and diet conflicts flag "meat substitute"/"imitation meat"/"chicken-free"
(`todos/P3-2026-11-01-diet-conflict-substitute-words-flag-meat.md`).

## Related Files

- `scripts/harness/verdict-diff.sh`, `scripts/harness/verdict-diff/` (registry, seeds, guard worker, keyword runner)
- `scripts/lib/verdict-diff-stamp-path.sh`
- `.claude/hooks/pr-preflight-guard.sh` (the gate), `.claude/hooks/test-pr-preflight-guard.sh` section 17
- `.claude/agents/todo-executor.md` Step 6
- `docs/solutions/logic-errors/command-text-matcher-on-canonical-spellings-misses-shell-shapes-2026-10-17.md` (the #1476 → #1479 chain)
