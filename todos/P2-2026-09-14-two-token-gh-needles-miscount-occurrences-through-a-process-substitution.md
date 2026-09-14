---
title: "The two-token gh needles miscount occurrences through a process substitution, so a hidden second merge is invisible to the ambiguity refusal"
status: backlog
priority: medium
created: 2026-09-14
updated: 2026-09-14
assignee:
labels: [deferred, harness, security]
github_issue:
---

# Two-token gh needles miscount occurrences through a process substitution

## Summary

`guard-outward-cli.sh` refuses a command carrying more than one `gh pr merge` (or `gh api`,
or `gh pr create|comment`) occurrence, because it cannot verify each one independently. A
**process substitution** is absorbed into the span between the binary and its namespace, so a
genuinely-executing second invocation is counted as zero and the refusal never fires.

`gh api` was fixed on 2026-09-13/14 (`_OUT_GH_GLOBALS_SEPSAFE` + a `max()` of two grammars).
The **two-token** families — `pr merge`, `pr create|comment`, `release …`, `repo …` — were
left, because they were believed structurally immune. They are immune to the _value-arm_
collapse; they are **not** immune to this one.

## Measured 2026-09-14

Counted with the guard's own needles, on the branch and on `main` separately:

| command                                 | merge occurrences                 |
| --------------------------------------- | --------------------------------- |
| `gh pr merge 7;gh pr merge 42`          | 2 — the refusal fires             |
| `gh -a -c <(gh pr merge 7) pr merge 42` | **1** on `main` AND on the branch |

**PRE-EXISTING.** `main` and the branch count identically, so the root-position work neither
opened nor closed this.

**No live ALLOW was found.** Five variants — including a real `--auto` on the outer merge with
a decoy `--auto` glued to the hidden inner one, and the reverse ordering — all still DENY. But
they deny on the `without a REAL --auto flag` branch, **not** on the ambiguity branch: the
second merge is invisible to the counter, and the deny happens because the clause cut does not
happen to find a real `--auto` inside the miscounted clause. That is accidental safety,
contingent on the clause cut's exact scope, not a structural guarantee.

## Mechanism

`_OUT_SEP` — the separator between the binary and its namespace — interpolates the **shared**
`_CMD_REDIR`, whose target class is `[^[:space:];&|)` + backtick + `]+` and therefore **admits
`(`**. A process substitution reads as "a redirect to a file named `(gh`", so ` <(gh pr merge 7)`
is swallowed and the whole string matches as a single occurrence.

This is the same mechanism that defeated the first `gh api` fix, one family over. That fix
narrowed the count-only grammar to `_OUT_POS_PREFIX`'s full anchor set (`[;&|(` + backtick +
`{!]`) and gave it a locally-narrowed redirect arm, `_OUT_SEP_SEPSAFE`.

## Acceptance Criteria

- [ ] `gh -a -c <(gh pr merge 7) pr merge 42` counts **two** merge occurrences and denies on
      the ambiguity reason, on every two-token family (`pr merge`, `pr create|comment`,
      `release`, `repo`).
- [ ] The three tripwire rows in `test-guard-outward-cli.sh` (search `TRIPWIRE: a hidden
    second pr merge`) are **converted**, not deleted — they currently pin the miscount's
      accidental DENY and its reason.
- [ ] Two-sided in the same run: the sanctioned automerge
      (`gh pr merge <n> --auto --squash --delete-branch`) still ALLOWS, and the `;` spelling
      still denies on the ambiguity reason.
- [ ] Generated corpus rows keyed on **command-position openers**, not separators — the axis
      that missed this for `gh api` varied `;&|` only. `.claude/hooks/repro-outward-cli-corpus.sh`
      has the shape to copy (search `apicollapse-`).
- [ ] The fail-closed assertion gains an operand for any new constant, and the needle that
      consumes it is asserted too — the operand/consumer split has now been the finding twice.
- [ ] `Outward-CLI guard corpus` re-pinned green against branch ⊕ main.

## Implementation Notes

The `gh api` fix is the template, in `.claude/hooks/guard-outward-cli.sh` — cite by text, not
line: `_OUT_SEPSAFE_TOK`, `_OUT_SEPSAFE_REDIR`, `_OUT_SEP_SEPSAFE`, `_OUT_GH_GLOBALS_SEPSAFE`,
and the `max()` at `_gh_api_n_wide`/`_gh_api_n_sepsafe`.

**Do not narrow the shared `_CMD_REDIR`.** Its target class admits `(` deliberately and every
consumer of the library reads it. Narrow a copy used at the counting site only.

**Narrowing is safe in the max() direction** — `max ≥ wide` always — so it can only add denies.
That is what makes this approach tractable on a gate where over-denial has a per-command
escape here (`ALLOW_OUTWARD_CLI=1`) but none in `merge-review-guard.sh`.

**Expect the merge family to be touchier than `gh api`.** Its block carries the `--auto`
carve-out, the `--admin` deny and the repo-retarget check, and the count decides whether that
block runs at all (`if -gt 1 / elif -eq 1 / fi`, with no `else`). Raising a count from 1 to 2
moves a command from the carve-out path to the ambiguity deny — which is the intent, but it
will flip currently-allowed shapes, so pair every new deny with the sanctioned automerge row.

## Risks

- `.claude/hooks/**` feeds main's 9th **required** check with no `paths:` filter; a careless
  edit wedges every open PR.
- The `--auto` carve-out is the one grant-shaped read in that file. Two live false grants were
  found there in review during the `gh api` work. Any change near the merge count should be
  measured against it explicitly, not reasoned about.

## Dependencies

None. The `gh api` half is closed
(`todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`).

## Updates

### 2026-09-14

Filed from round-3 baseline review of PR #957, which asked whether the "two-token families
cannot collapse" claim in that PR's own header covered the `(` mechanism. It did not — it was
true of the value-arm mechanism only. The claim has been scoped in place and the current
miscount pinned as tripwires rather than left undisclosed.
