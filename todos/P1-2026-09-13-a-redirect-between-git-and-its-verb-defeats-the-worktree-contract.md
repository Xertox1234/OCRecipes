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
      with the applicable denominator (see the note below about `push`). **The position axis
      MUST include a glued, zero-space spelling (`git>out …`)** — the first candidate for this
      todo passed a 630-row corpus that held spacing fixed and missed every glued row.
- [ ] Mutation-verified: revert the new alternative and confirm only the redirect rows redden.
- [ ] `.claude/hooks/test-git-safety.sh` gains the rows; full hook suite green.

## Implementation Notes

**Reuse the shared grammar; do not re-derive it.** `lib/cmd-detect.sh:117` already defines
`_CMD_REDIR`, which models fd prefixes, `{name}` fds, `&` on either side, and the `|`/`!`
clobber overrides. Re-deriving a redirect grammar in the consumer is this repo's
most-repeated defect — PR #940 fixed the sibling instance in `guard-outward-cli.sh` by
reusing this same constant.

**And reuse the shared GROUP, not just the shared constant.** `lib/cmd-detect.sh:151` already
defines `_CMD_GIT_GLOBALS` — the whole "what may sit between `git` and its verb" group,
including a redirect branch built correctly. Replace the hand-written group outright:

```bash
MUTATING_GIT_SEG_RE="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git${_CMD_GIT_GLOBALS}[[:space:]]+(${MUTATING_GIT_VERBS})([[:space:]]|\$)"
```

`git-safety.sh` does **not** source `lib/cmd-detect.sh` today (verified — the file has no
`source` statement at all), so the fix needs that line too.

**Measured, corpus generated from its dimensions** — 14 operators × 4 targets × 6 verbs × 4
positions (spaced / **glued** / between-globals / pre-verb) = **1344 rows**:

|                           | shipped | `_CMD_GIT_GLOBALS` wholesale |
| ------------------------- | ------- | ---------------------------- |
| rows SEEN                 | 0       | **1344**                     |
| SEEN → MISSED regressions | —       | **0**                        |

Controls hold in both directions: `git status`, `git 2>/dev/null status`, `echo hello` and
`npm run build` all stay MISSED; the three shipped-SEEN spellings stay SEEN.

### Two corrections to an earlier revision of this section, recorded rather than overwritten

**(1) A hand-spliced `${_CMD_REDIR}` into the local group is WRONG, and misses every glued
spelling.** That version put the redirect behind the group's shared mandatory `[[:space:]]+`,
so `git>out commit -m x` — a real bash invocation, since bash splits at an operator with no
surrounding space — still failed to match. `_CMD_GIT_GLOBALS` separates its redirect branch
with `[[:space:]]*` (zero-or-more) precisely for this, and `guard-outward-cli.sh` uses the
same idiom. **Citing the precedent is not following it**: the constant was reused and the
structure around it was re-derived, which is the same defect one level down.

**(2) The corpus that "verified" the spliced version held the spacing axis FIXED.** Its three
positions were all space-separated, so the glued spelling could not appear and the result read
504/504. Re-run with a glued position included, that candidate sees 336 of 504. An axis you do
not vary is an axis where a defect is invisible.

A third note kept from that revision because it is still true: an earlier reading of "504 of
630" as "the candidate still misses 126" was wrong — those 126 all used `push`, which is not
in `MUTATING_GIT_VERBS` (`commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean`).
They were correctly missed. Generating from a product of dimensions does not help if one axis
carries values outside the population the check governs; quote the APPLICABLE denominator.

## Scope Contract

- **Mechanisms to use:** replace the hand-written globals group with `_CMD_GIT_GLOBALS` from
  `lib/cmd-detect.sh`, sourcing that library. No new constant, no locally re-derived redirect
  grammar, no hand-spliced alternative, no second predicate.
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
- `_CMD_REDIR`'s target is mandatory and greedy. The 1344-row sweep varies the target across
  four values and shows 0 SEEN → MISSED transitions, so it does not swallow the verb on any
  spelling tested — but that is a bound from the tested set, not a proof.
- **DISCLOSED RESIDUAL, out of scope and NOT closed by this fix: a redirect BEFORE the `git`
  token.** `2>/dev/null git commit -m x` is a real, equally valid bash invocation and is
  MISSED by the shipped regex, by the spliced candidate, and by the `_CMD_GIT_GLOBALS`
  version alike — the segment anchor `^[[:space:]]*(ENV=val )*git…` never reaches `git` when
  a redirect precedes it, and this fix only touches the group BETWEEN `git` and the verb.
  Measured. It is the same defect class in a different position, so an implementer closing
  this todo must not report the redirect bypass as closed. `lib/cmd-detect.sh:118`'s
  `_CMD_POS_PREFIX` already carries `_CMD_REDIR` as a leading-prefix alternative, so the
  library models this shape — extending the anchor is a separate, larger change and wants
  its own todo rather than being smuggled in here.

## Updates

### 2026-09-13

- Filed at the user's explicit request. The bypass, the absence of any other covering layer,
  and the candidate fix were each measured rather than inherited from the inventory note that
  surfaced it.
