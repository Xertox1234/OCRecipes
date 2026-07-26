---
title: "git-safety delete advisor reports 'NO PR found' for any QUOTED branch name"
status: backlog
priority: low
created: 2026-07-25
updated: 2026-07-25
assignee:
labels: [deferred, harness, git-safety]
github_issue:
---

# git-safety delete advisor reports "NO PR found" for any QUOTED branch name

## Summary

The branch-delete advisor in `.claude/hooks/git-safety.sh` extracts the branch
name by regex over the raw command text, and the capture group
(`([^[:space:];&|]+)`, line 548) **never strips quotes**. So any quoted branch
name — `git branch -D "todo/foo"` just as much as `git branch -D "$B"` — yields a
`REF` with literal quote characters, `gh pr view '"todo/foo"'` returns "no pull
requests found", and the hook emits its most alarming message: _"NO PR found …
deleting it may lose never-pushed work"_ — for a branch whose PR may well be
merged.

Separately, the existing flag-like guard at lines 569-571 warns "Fresh PR check
**skipped**" and then falls through to run `gh pr view` anyway, so that message
is false whenever it fires.

## Background

Observed live during a `/todo` Phase 5 cleanup on 2026-07-25 (deleting
`todo/P3-2026-07-25-setcamerazoom-silent-catch` after PR #720 merged). The same
command ran `scripts/verify-branch-merged.sh "$B"` first — which received the
_expanded_ argument and correctly printed `is MERGED at its PR head — safe to
delete` — and the hook fired its contradictory warning immediately after.

The shell-variable form was only the symptom that happened to surface it. A
plain quoted literal hits the identical path:

```
git branch -D "todo/foo"   ->  REF: ["todo/foo"]   # false "NO PR found"
git branch -D todo/foo     ->  REF: [todo/foo]     # only the unquoted form works
git branch -D "$B"         ->  REF: ["$B"]
```

Impact is **noise, not danger**: the advisor is warn-only and never blocks, and
the real gate (`verify-branch-merged.sh`) behaved correctly. But a confident,
specific, wrong warning trains the reader to discount the hook — and this is the
one hook whose entire value is making a human stop and think before a destructive
delete (the PR #520 incident class it was built for).

The existing advisor tests (`test-git-safety.sh:499-513`) use **unquoted**
literals exclusively, which is why nothing in the suite caught this.

## Acceptance Criteria

- [ ] Surrounding quotes are stripped from `REF` at the normalization point
      (beside `REF="${REF#origin/}"`, line 567), so `git branch -D "todo/foo"`
      resolves its PR exactly as the unquoted form does
- [ ] After stripping, a `REF` that still cannot be a literal branch name (it
      contains `$` or a backtick — i.e. an unexpanded shell construct) produces
      an "unresolvable ref" warning stating that the branch name could not be
      resolved from the command text and that merge state must be confirmed
      manually. It must NOT assert that no PR exists
- [ ] Both the new unresolvable-ref case and the **existing** flag-like case
      (`-*`, line 569) skip the `gh pr view` lookup rather than falling through
      to it, so exactly one warning is emitted per command and the flag case's
      "Fresh PR check skipped" message becomes true
- [ ] `.claude/hooks/test-git-safety.sh` covers four cases, each asserting a
      **distinct** message: quoted literal with a MERGED PR (reports MERGED),
      variable-quoted (`git branch -D "$B"`, reports unresolvable), genuine no-PR
      literal (still reports NO PR found), and flag-like (reports skipped, and
      does not additionally report NO PR found)

## Implementation Notes

- Strip only **matched surrounding** quotes, via parameter expansion:

  ```sh
  case "$REF" in
    \"*\") REF="${REF#\"}"; REF="${REF%\"}" ;;
    \'*\') REF="${REF#\'}"; REF="${REF%\'}" ;;
  esac
  ```

  Do **NOT** use `tr -d '\042\047'` here. The comments at lines 88, 169 and 509
  record why that shape was wrong for the other extractors — it deletes quote
  characters while keeping their content, which merges adjacent tokens. For this
  advisor we only want the outer pair removed.

- The `$`/backtick check must run **after** the strip, so `"$B"` normalizes to
  `$B` and the check operates on a bare token.
- Do NOT attempt to resolve the variable (no `eval`, no scanning earlier commands
  in the string for an assignment). Evaluating attacker-influenced command text
  inside a security hook is strictly worse than an honest "unknown". The goal is
  to downgrade a false certainty to a stated uncertainty.
- The fall-through fix is the load-bearing part of AC#3: lines 569-571 are a
  bare `case … esac` with no skip, and line 572 runs `gh pr view` unconditionally.
  If the new unresolvable case is added as a naive sibling `case`, it inherits
  the same fall-through and emits **both** "unresolvable" and "NO PR found" —
  worse than today. Restructure the block so a resolved ref is the only path that
  reaches the lookup.
- Keep it warn-only. This hook must never gain a deny path.

## Scope Contract

- **Mechanisms to use:** the existing `case "$REF"` guard pattern and the
  existing `warn` helper, plus shell parameter expansion. No new helper, no
  shared library, no changes to any other extractor in the file.
- **Files in scope:** `.claude/hooks/git-safety.sh`,
  `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Git permits `$` in a ref name, so a branch genuinely named `feat/a$b` would
  newly get "unresolvable" instead of a real PR lookup. That trade is acceptable
  (a softer warning on a rare valid name beats a confidently wrong one on a
  common invocation), but note it in a comment so a later reader does not "fix"
  it back.
- Restructuring the block to skip the lookup touches the control flow every
  advisor path runs through. The four AC#4 tests plus the five existing cases at
  `test-git-safety.sh:499-513` must all pass — the existing ones are the
  non-regression proof.
- Assert on message **identity**, not just exit status. The whole defect is that
  the wrong branch of a warn-only hook was taken, which no exit code
  distinguishes.

## Updates

### 2026-07-25

- Initial creation. Observed during `/todo` Phase 5 cleanup after PR #720 merged;
  the hook contradicted `verify-branch-merged.sh` in the same command.
- Rescoped after code review of PR #721: the defect is quote-stripping, not shell
  variables specifically — a quoted _literal_ branch name hits the same path, and
  the original acceptance criteria would have shipped a `$`-detector while leaving
  that case broken. The flag-case fall-through was promoted from an
  Implementation-Notes hedge to an acceptance criterion after being verified
  against lines 569-572.
