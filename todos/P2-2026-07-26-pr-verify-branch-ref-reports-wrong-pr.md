---
title: "pr-verify.sh reports the CURRENT branch's PR as verified when gh pr merge/close/edit is given a branch name"
status: backlog
priority: medium
created: 2026-07-26
updated: 2026-07-26
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

- [ ] A branch-name ref (`gh pr merge my-branch`) resolves that branch's PR, not
      the current branch's
- [ ] A URL ref (`gh pr merge https://github.com/o/r/pull/42`) resolves PR 42
- [ ] When the ref cannot be resolved for a `merge`/`close`/`edit` command, the
      hook emits an explicit could-not-verify message and **never** silently falls
      back to the no-args lookup — the fallback stays correct only for `create`
      (and the MCP create path), where the current branch genuinely is the subject
- [ ] The numeric path and the wrapper case (`timeout 30 gh pr merge 42` → 42,
      never 30) are unchanged — the existing `cmd-detect.sh` tests still pass
- [ ] Test coverage in the `cmd-detect.sh` / `pr-verify.sh` test harness for:
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
