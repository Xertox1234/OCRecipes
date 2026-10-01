---
title: "cmd_gh_pr_ref's POST-verb flag walker still enumerates gh's flags, in two separate copies, and one real flag is missing from both"
status: backlog
priority: medium
created: 2026-09-13
updated: 2026-09-22
assignee:
labels: [deferred, harness, security]
github_issue:
---

# The post-verb flag walker still enumerates, one slot over from the slot just fixed

## Summary

`todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`
replaced a named flag list with a modelled PROPERTY in the slot **before** the namespace.
`cmd_gh_pr_ref` has a **second** flag walker in the slot **after** the verb, and that one is
still a named enumeration — kept in **two separate copies** — with one real `gh` flag absent
from both.

## Background

The post-verb walker exists to skip flag tokens while looking for the PR ref, so that
`gh pr edit --add-label bug 42` resolves `42` and not `bug`. It does that with a literal
alternation of value-taking flag names, and a second literal copy of the same names guards
the result:

- `lib/cmd-detect.sh` — `local value_flags='--author-email|--body-file|…'` (18 long forms),
  interpolated into the `full_match` regex.
- the same file, ~40 lines later — a `case "$prev" in` listing **the same 18 long forms [staleness-ok]
  plus the short forms** `-A|-b|-F|-t|-c|-B`, which `return 1` (refuse).

That duplication is the hazard this repo already records: _"Two literal copies of one grammar
is precisely how `_CMD_POS_SUFFIX`/`_OUT_POS_SUFFIX` and the `_CMD_POS_PREFIX`
redirect-absorption gap each became a live bypass: the guard's copy fell behind the lib's and
nothing compared them."_ Here the two copies are already **not** identical — the short forms
appear in one and not the other.

## Measured 2026-09-13

Derived by set difference between `value_flags` and the union of
`man gh-pr-merge` / `gh-pr-close` / `gh-pr-edit` (every entry rendered `--flag <PLACEHOLDER>`):

```
in the man pages but NOT in value_flags:   --attach
in value_flags but NOT in the man pages:   (none)
```

`--attach <file>` is a real `gh pr edit` flag. Its value is resolved AS THE REF:

| command                                           | resolved ref | correct |
| ------------------------------------------------- | ------------ | ------- |
| `gh pr edit --attach notes.txt 42`                | `notes.txt`  | `42`    |
| `gh pr edit --attach 99 42`                       | **`99`**     | `42`    |
| `gh pr edit --title hello 42` _(listed, control)_ | `42`         | `42`    |
| `gh pr merge --subject 99 42` _(listed, control)_ | `42`         | `42`    |

Two further behaviours, measured in the same run and **not** the same direction:

- **Short forms of listed flags fail CLOSED.** `gh pr merge -t 99 42` → rc 1, no ref, so the
  merge gate denies with "could not resolve a PR number". They are missing from
  `value_flags` but present in the `prev` case, which refuses. An accuracy cost, not a gap.
- **Unlisted flags resolve the WRONG ref.** `gh pr merge -Z 99 42` → `99`. Not currently
  reachable by a functional command (`-Z` is not a gh flag), but that is what a FUTURE gh
  flag would do on the day it ships.

## Why this is P2 and not P0

The merge gate acts only when the subcommand is `merge`, and every value-taking flag
documented for `gh pr merge` is covered by at least the `prev` copy. `--attach` belongs to
`gh pr edit`, so no **functional** command reaches the merge gate with a misresolved ref
today. The live consumer is `pr-verify.sh`, which is non-blocking and would report the wrong
PR as verified.

It is not P3 because the failure MODE is the bad one: a misresolved ref is not a refusal, it
is the gate classifying **a different PR's review record** while `gh` acts on the intended
one. That is a false grant on the wrong record, and only the flag table keeps it unreachable.

## Acceptance Criteria

- [ ] `--attach` is covered, and the set is **derived** — paste the `man gh-pr-<verb>`
      derivation into the source next to the list so the next reader re-runs it rather than
      re-trusts it.
- [ ] The two copies become ONE definition, or a test asserts they agree member-for-member.
      Whichever: the short forms must be in the same place as the long forms.
- [ ] A decision, recorded with its reasoning, on what an UNLISTED value-taking flag should
      do. Resolving the first non-dash token is the wrong default; refusing when a bare-dash
      token is followed by two or more non-dash tokens is the fail-closed shape. **Note the
      property trick from the P0 does NOT transfer here** — making the bare-dash arm consume
      a following token would swallow the ref itself, so `gh pr merge --squash 42` would
      refuse. The ambiguity is genuine: `gh` resolves it with a flag table this guard does
      not have.
- [ ] Two-sided, in the same run: `gh pr merge --squash 42` and `gh pr merge 42` still
      resolve `42`; `gh pr edit --attach 99 42` resolves `42`, not `99`.
- [ ] Corpus rows generated, and `Outward-CLI guard corpus` re-pinned green against
      branch ⊕ main.

## Implementation Notes

Both lists are in `.claude/hooks/lib/cmd-detect.sh`, inside `cmd_gh_pr_ref` — cite them by
their text (`local value_flags=` and `case "$prev" in`), not by line number; this function
moved twice on 2026-09-13 alone.

Derivation used above, reusable verbatim:

```
man /opt/homebrew/share/man/man1/gh-pr-<verb>.1 | col -b \
  | grep -oE '^[[:space:]]*(-[A-Za-z], )?--[a-z-]+ <[^>]+>'
```

Grep the placeholder as `<[^>]+>`, **not** `<[a-z-]+>`: the narrower class silently drops
`--match-head-commit <SHA>` on the placeholder's CASE. That near-miss happened while deriving
this very set.

## Risks

- `lib/cmd-detect.sh` feeds `merge-review-guard.sh`, `pr-verify.sh` and
  `pr-preflight-guard.sh`, and the corpus is main's 9th **required** check with no `paths:`
  filter — a careless edit wedges every open PR.
- Widening what counts as a flag moves refs from "resolved" to "refused". On the merge gate a
  refusal is a DENY with no per-command escape, so pair every new refusal with a row proving
  the ordinary spellings still resolve.

## Dependencies

None. The P0 that surfaced this is closed
(`todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`).

## Updates

### 2026-09-13

Filed from the advisor review of the P0's closing change, which asked whether the same
construct one slot over was complete. It was not. The reusable lesson is already codified at
`docs/solutions/logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md`
— this todo is that doc's own prescription applied to the site it did not reach.

### 2026-09-22 — user ruling on the gated decision: STAY FAIL-OPEN

- Put to the user in session as "an unlisted value-taking flag after the verb: stay fail-open
  (may classify the wrong PR's record) or go fail-closed (some legitimate commands deny with no
  escape hatch)?" — answer: **stay fail-open**. The middle acceptance criterion is therefore
  resolved as "keep resolving the first non-dash token", documented as an accepted posture
  rather than changed. The other two criteria (one copy of the flag list, and the real flag that
  is missing from both) are ordinary implementation work and can proceed. `human_led` removed
  on that in-session ruling; nothing else in the frontmatter changed.
