---
title: "A redirect between `git` and its verb defeats MUTATING_GIT_SEG_RE, so the worktree contract is not enforced on that command"
status: backlog
priority: high
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A redirect between `git` and its verb defeats the worktree contract

## Summary

`MUTATING_GIT_SEG_RE` models the tokens that may appear between `git` and its verb as
globals — `-C <x>`, `-c <x>`, `--git-dir <x>`, `--work-tree <x>`, or a generic `-<flag>`. A
redirect token starts with a digit, `>`, `<`, `&` or `{`, so it matches none of them. The
segment fails the regex, `git-safety.sh:446` takes its `|| continue`, and the worktree
contract is never checked for that command.

```
git 2>/dev/null commit -m x     ->  the guard does not see a mutating git command
```

This is the only layer for mutating git via Bash: `guard-worktree-isolation.sh` covers file
tools only (Edit / Write / MultiEdit / NotebookEdit), and `MUTATING_GIT_SEG_RE` appears
nowhere else in `.claude/hooks/` except its own test. There is no backstop.

## Background

Carried from an inventory of open guard gaps; measured 2026-09-13 rather than inherited as a
claim. The regex was extracted from the shipped hook (not transcribed) and matched against
strings — no git command was executed.

### The bypass, with controls in both directions

| segment                                  | regex verdict |
| ---------------------------------------- | ------------- |
| `git commit -m x` _(control)_            | SEEN          |
| `git -C /tmp commit -m x` _(control)_    | SEEN          |
| `git --no-pager commit -m x` _(control)_ | SEEN          |
| `echo hello` _(control)_                 | MISSED        |
| `git status` _(control)_                 | MISSED        |
| `git 2>/dev/null commit -m x`            | **MISSED**    |
| `git >/dev/null commit -m x`             | **MISSED**    |
| `git 2>&1 commit -m x`                   | **MISSED**    |
| `git >out commit -m x`                   | **MISSED**    |
| `git 1>/dev/null commit -m x`            | **MISSED**    |
| `git 2>>log commit -m x`                 | **MISSED**    |

The controls matter: three spellings that must be SEEN are, and two that must be MISSED are,
so the probe separates the verdicts rather than reporting one of them for everything.

**Position is load-bearing.** `git commit -m x 2>/dev/null` — the redirect _trailing_ — is
SEEN. Only an interposed redirect defeats it, because only there does it sit inside the
globals group the regex is walking.

### Why the existing comment does not cover it

The block above the constant argues the grammar is a "STRICT SUPERSET" of its predecessor
and that it models the globals which "only need to REACH the verb". That is true of globals
and says nothing about redirects, which are not globals. The comment is accurate and the gap
is still there — it is a case the author was not modelling, not a claim that was wrong.

## Severity note

Filed **high**. It is an active bypass of a live control — the command runs now, unguarded —
which is the criterion that put
`todos/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md` at
critical. It sits a tier below because the blast radius is narrower: the worktree contract
prevents accidental cross-checkout mutation during isolated work, and it already has a
sanctioned one-shot escape (`SKIP_WORKTREE_CONTRACT=1`), so this is an undocumented route to
something a caller may legitimately ask for — not an unreviewed merge to `main`. Bump it if
you weigh the isolation guarantee higher.

## Acceptance Criteria

- [ ] `MUTATING_GIT_SEG_RE` SEES a mutating git command carrying a redirect between the
      binary and the verb, for every redirect spelling `_CMD_REDIR` models.
- [ ] Controls in the same run, both directions: `git status` / `git log` with the same
      interposed redirect stay MISSED (a read-only verb must not become a deny), and ordinary
      prose stays MISSED.
- [ ] No SEEN → MISSED transition anywhere — the change must be strictly tightening, the same
      property the existing comment claims for its own predecessor and backs with a
      differential.
- [ ] Corpus generated from a product of dimensions (operator × target × verb × position),
      not hand-listed, with every count quoted together with the corpus that produced it AND
      with the applicable denominator (see the note below about `push`).
- [ ] Mutation-verified: revert the new alternative and confirm only the redirect rows redden.
- [ ] `.claude/hooks/test-git-safety.sh` gains the rows; full hook suite green.

## Implementation Notes

**Reuse the shared grammar; do not re-derive it.** `lib/cmd-detect.sh:117` already defines
`_CMD_REDIR`, which models fd prefixes, `{name}` fds, `&` on either side, and the `|`/`!`
clobber overrides. Re-deriving a redirect grammar in the consumer is this repo's
most-repeated defect — PR #940 fixed the sibling instance in `guard-outward-cli.sh` by
reusing this same constant.

**`git-safety.sh` does not source `lib/cmd-detect.sh` today** (verified). The fix therefore
needs that source line as well as the regex change, so weigh whether the hook wants the whole
library or just the one constant.

Candidate — one alternative added to the globals group:

```bash
MUTATING_GIT_SEG_RE="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--git-dir[[:space:]]+[^[:space:]]+|--work-tree[[:space:]]+[^[:space:]]+|${_CMD_REDIR}|-[^[:space:]]+))*[[:space:]]+(${MUTATING_GIT_VERBS})([[:space:]]|\$)"
```

**Measured, corpus generated from its dimensions** — 14 operators × 3 targets × 5 verbs × 3
positions = **630 rows**:

|                           | shipped | candidate |
| ------------------------- | ------- | --------- |
| rows SEEN                 | 0       | 504       |
| SEEN → MISSED regressions | —       | **0**     |

All nine controls classify identically under both regexes, and read-only verbs with the same
interposed redirect (`git 2>/dev/null status`, `… log`) stay MISSED under the candidate.

**Read the denominator carefully: 504, not 630, is the applicable population.** The remaining
126 rows are every combination using `push`, which is **not in `MUTATING_GIT_VERBS`** — the
constant is `commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean`.
Those rows are correctly MISSED and are an artifact of the corpus, not a gap in the fix. This
is recorded because the first reading of that 504/630 figure was "the candidate still misses
126", which is wrong: generating from a product of dimensions does not help if one axis
carries values outside the population the check governs.

## Scope Contract

- **Mechanisms to use:** add `_CMD_REDIR` as one alternative inside the existing globals
  group, sourcing `lib/cmd-detect.sh`. No new constant, no locally re-derived redirect
  grammar, no second predicate.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of the open merge-gate P0/P1s, though it is the same defect CLASS — a
  redirect interposed where a grammar expected only flags — and `guard-outward-cli.sh`'s
  already-shipped fix is the worked example.

## Risks

- **Hook edits feed a required check.** The `Outward-CLI guard corpus` job covers
  `.claude/hooks/` and is main's 9th required check. Run it against branch ⊕ main, never the
  bare tip.
- **The false-DENY direction has no per-command escape worth relying on.** `git-safety.sh`
  does honour an inline `SKIP_WORKTREE_CONTRACT=1 ` prefix, so recovery is cheaper here than
  in the merge gate — but a guard that denies ordinary read-only git still gets switched off.
  Pair every new deny row with a read-only-stays-allowed row in the same run.
- `_CMD_REDIR`'s target is mandatory and greedy. Check it cannot swallow the verb itself on
  some spelling — the candidate above shows 0 SEEN → MISSED transitions over 630 rows, but
  that corpus fixes the target at three values; vary it.

## Updates

### 2026-09-13

- Filed at the user's explicit request. The bypass, the absence of any other covering layer,
  and the candidate fix were each measured rather than inherited from the inventory note that
  surfaced it.
