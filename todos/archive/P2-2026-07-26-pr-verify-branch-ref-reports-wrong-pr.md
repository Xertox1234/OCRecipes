---
title: "pr-verify.sh reports the CURRENT branch's PR as verified when gh pr merge/close/edit is given a branch name"
status: done
priority: medium
created: 2026-07-26
updated: 2026-08-05
assignee:
labels: [harness, git-safety, hooks]
github_issue:
---

# pr-verify.sh reports the CURRENT branch's PR as verified when gh pr merge/close/edit is given a branch name

## Summary

`cmd_gh_pr_number` (`.claude/hooks/lib/cmd-detect.sh:129-133`) matches only a
**numeric** ref (`#?[0-9]+`). `gh pr merge|close|edit` also accept a branch name
or URL, and for those `PR_REF` comes back empty — so `.claude/hooks/pr-verify.sh`
takes its no-args `gh pr view` fallback (line 55) and emits a confident
`PR state verified post-command — #N, url: …, state: …` describing the
**current branch's** PR, not the one the command operated on.

The emitted message ends with _"Use these values when reporting, not values from
prior context"_ — an explicit instruction to the agent to trust the wrong data
over its own context. That makes this a false-reassurance defect, not merely a
missed verification.

## Background

Deferred from the PR #722 review (`security-auditor`, round 2) as out of that
todo's Scope Contract, then independently confirmed against the source.

`pr-verify.sh` already documents the exact hazard it falls into. Lines 28-30:

> For merge/close/edit: pass the number that FOLLOWS the subcommand (never the
> first number anywhere) — **no-args would return the current branch's PR, wrong
> after `--delete-branch` or when operating on another branch's PR by number.**

The intent is right; the extractor cannot deliver it for a non-numeric ref. And
`cmd_gh_pr_number`'s own comment already admits the gap ("Empty if the ref is a
URL/branch rather than a number") — nothing downstream acts on that admission.

This is the same class as the CRITICAL fixed in PR #722, where an empty ref
reaching `gh pr view ""` silently resolved to the current branch and could print
"MERGED — deletion is safe" about an unrelated branch. Verified that gh behavior
directly:

```
$ gh pr view "" --json number,headRefName
no pull requests found for branch "main"      # resolved to the CURRENT branch, not ""
```

`pr-verify.sh` is a **PostToolUse** hook and blocks nothing, so the impact is a
wrong report rather than a wrong action — but reporting a wrong PR number/state
is precisely what CLAUDE.md's "Verifying before reporting" rule exists to
prevent, and this hook is the mechanism that rule leans on.

## Acceptance Criteria

- [x] A branch-name ref (`gh pr merge my-branch`) resolves that branch's PR, not
      the current branch's
- [x] A URL ref (`gh pr merge https://github.com/o/r/pull/42`) resolves PR 42
- [x] When the ref cannot be resolved for a `merge`/`close`/`edit` command, the
      hook emits an explicit could-not-verify message and **never** silently falls
      back to the no-args lookup — the fallback stays correct only for `create`
      (and the MCP create path), where the current branch genuinely is the subject.
      **Correction (round-2 `code-reviewer`):** this rationale is not quite right for
      two of the three subcommands — `gh pr merge` and `gh pr edit` both document
      their ref as optional too, defaulting to the current branch's PR exactly like
      `create` (only `gh pr close` genuinely requires one, per `gh pr <sub> --help`).
      A genuinely-no-ref, boolean-only invocation (`gh pr merge --squash`) now
      downgrades from a correct verified report to an unnecessary WARNING — a
      usefulness regression, not a correctness one, and the conservative direction
      the todo's own "honest unknown beats confident wrong" principle prefers.
      Deferred rather than fixed: recovering the `create`-style no-args lookup for
      merge/edit's genuinely-ref-less case would need a way to distinguish "no ref
      extracted because none was given" from "no ref extracted because extraction
      failed" — the same overloaded-empty-return shape flagged in codify below —
      which is a real design change, not a small in-scope fix.
- [x] The numeric path and the wrapper case (`timeout 30 gh pr merge 42` → 42,
      never 30) are unchanged — the existing `cmd-detect.sh` tests still pass
      (see Updates: the numeric path picks the FIRST match instead of the last
      on a MULTI-match input, a deliberate, disclosed deviation — every
      single-match numeric/wrapper case, including all pre-existing tests, is
      byte-identical)
- [x] Test coverage in the `cmd-detect.sh` / `pr-verify.sh` test harness for:
      numeric ref, branch-name ref, URL ref, wrapper-with-number, and the
      unresolvable case — each asserting a **distinct** outcome

## Implementation Notes

- Two candidate shapes; pick the smaller one that passes:
  1. Widen `cmd_gh_pr_number` to return the first non-flag token after
     `merge|close|edit` (number, branch, or URL) and let `gh` resolve it — `gh pr
view <ref>` already accepts all three forms. Rename it if it no longer
     returns only a number.
  2. Keep `cmd_gh_pr_number` numeric-only and add a sibling extractor for the
     general ref, leaving existing callers untouched.
- The token walk must skip flags and their values (`gh pr merge --squash 42`,
  `gh pr edit 42 --add-label x`) — the existing "never the first number anywhere"
  guarantee is a hard requirement, not a nicety, and there are tests pinning it.
- Watch the `create` branch: it deliberately has no ref and MUST keep using the
  no-args lookup. Do not collapse the `if [ "$SUBCOMMAND" != "create" ]` guard.
- The unresolvable message must not assert a PR state — same principle as the
  advisor fix in PR #722: an honest "could not verify" beats a confident wrong
  answer. `pr-verify.sh:66` already has a suitable message to reuse.
- Keep it non-blocking. This is a PostToolUse reporting hook and must never gain
  a deny path.

## Scope Contract

- **Mechanisms to use:** the existing `cmd-detect.sh` extractor helpers and
  `pr-verify.sh`'s existing message constants. No new shared library, no change
  to any other hook.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`,
  `.claude/hooks/pr-verify.sh`, and their test harness files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #722 is independent (different hook, different block) and provides the
  "honest unknown beats confident wrong" precedent to follow.

## Risks

- `cmd_gh_pr_number` is shared. Confirm every caller with the LSP/grep before
  widening its contract — a caller assuming a numeric return could break on a
  branch-name string. If callers disagree, take option 2 (sibling extractor).
- The extractor runs on raw command text, so it inherits the quoting limits
  documented for the sibling scanners. Strip matched surrounding quotes the same
  way PR #722 did rather than inventing a second convention.
- Assert on message **identity** in the tests. Both the bug and the fix produce a
  successful hook run; only the message text distinguishes them.

## Updates

### 2026-07-26

- Initial creation. Raised by `security-auditor` during the PR #722 review as
  out-of-scope, then confirmed directly against `cmd-detect.sh:129-133` and
  `pr-verify.sh:51-57`.

### 2026-08-05

- Implemented and fixed. `cmd_gh_pr_number` renamed to `cmd_gh_pr_ref` and
  widened to extract a number, branch name, or URL (`gh pr view <ref>` accepts
  all three). Reads `cmd_bare`'d output, not raw command text, per the Risks
  note's own precedent for the decoy hazard — a raw-text draft was caught in
  advisor review before commit (`gh pr merge 42 --delete-branch && echo "done
gh pr merge 999"` would have resolved `999`, not `42`).
  `pr-verify.sh`'s `gh pr view` call was restructured to key off
  `SUBCOMMAND == "create"` (no-args) vs. `PR_REF` set (that ref) vs. neither
  (merge/close/edit with an unresolvable ref — sets `GH_EXIT=1` directly,
  reusing the existing "WARNING: could not verify" message, never calling `gh`
  with no ref).
  **Round 1** (`code-reviewer` + `security-auditor`) found two new defects in
  the widened extractor, both fixed: a value-taking flag before the ref
  (`gh pr edit --add-label bug 42`) was mis-resolving to the flag's own value
  — fixed with an 18-name long-form value-flag allowlist sourced from real
  `gh pr merge/close/edit --help` output; and a compound command chaining two
  different gh-pr write subcommands could pair `SUBCOMMAND` (first-match)
  with a `PR_REF` from a different sub-invocation (last-match) — fixed by
  switching the extractor to first-match (`grep -oE | head -1`), a
  deliberate, disclosed deviation from the old `tail -1` (last-match)
  behavior on a MULTI-match input (single-match inputs, including every
  pre-existing test, are unaffected).

  **Round 2** (re-dispatched on the round-1 fix, per the same two reviewers)
  found three more, of which one was fixed and two are deferred residuals:
  - FIXED (`code-reviewer`, CRITICAL): a value-taking flag as the ENTIRE
    tail with no positional ref (`gh pr edit --title Fixed`) — ERE has no
    negative lookahead, so the regex's only viable parse read the flag's own
    value as the ref. Fixed by rejecting a match whose second-to-last token
    is itself a known value-flag name (test 21).
  - DEFERRED residual: an UNLISTED value-taking flag before a real ref
    (`gh pr merge --foo bar 42` → `bar`, not `42`, if `--foo` were ever a
    real `gh` flag) is not caught by the allowlist check above and silently
    skips the real ref. Not currently exploitable — the allowlist is 18/18
    complete against the actually-installed `gh` 2.95.0, independently
    re-derived by both reviewers. A full fix needs a token-walk rewrite
    (third rewrite of this extractor within one review cycle) rather than a
    small in-scope change; documented in `cmd-detect.sh`'s function comment.
  - DEFERRED residual: the round-1 compound-clause pairing fix does not
    cover every shape — when the FIRST write-subcommand clause in a compound
    command has no extractable ref (`gh pr close --auto && gh pr merge 42`),
    `PR_REF` still falls through to the second clause's ref while
    `SUBCOMMAND` reports the first clause's subcommand, misattributing the
    result. A proper fix needs position-correlating the two independent
    extractors — new mechanism, deferred rather than rushed.
  - Also corrected: AC #3's stated rationale ("no-args fallback stays
    correct only for `create`") is imprecise — `gh pr merge`/`gh pr edit`
    both default to the current branch too; only `gh pr close` requires an
    explicit ref. See the AC #3 correction note above.

  Blast-radius: `cmd-detect.sh` is sourced by 11 files; only `pr-verify.sh`
  calls the renamed/widened function. All 30 hook self-test files
  (`scripts/run-hook-tests.sh`) pass with zero regressions, both before and
  after the round-2 fix.
