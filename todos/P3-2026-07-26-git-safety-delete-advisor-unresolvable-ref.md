---
title: "git-safety delete advisor reports 'NO PR found' when the branch name is a shell variable"
status: backlog
priority: low
created: 2026-07-26
updated: 2026-07-26
assignee:
labels: [deferred, harness, git-safety]
github_issue:
---

# git-safety delete advisor reports "NO PR found" when the branch name is a shell variable

## Summary

The branch-delete advisor in `.claude/hooks/git-safety.sh` extracts the branch
name by regex over the raw command text. When the command passes the branch via
a shell variable (`git branch -D "$B"`), `REF` becomes the literal string `"$B"`,
`gh pr view '"$B"'` returns "no pull requests found", and the hook emits the most
alarming message it has — "NO PR found … deleting it may lose never-pushed work"
— for a branch whose PR is in fact merged.

## Background

Observed live during a `/todo` run on 2026-07-26 (Phase 5 cleanup of
`todo/P3-2026-07-25-setcamerazoom-silent-catch`, PR #720, confirmed MERGED). The
command ran `scripts/verify-branch-merged.sh "$B"` first — which expanded the
variable correctly and printed `is MERGED at its PR head — safe to delete` — and
the hook fired its contradictory warning immediately after.

Impact is **noise, not danger**: the advisor is warn-only and never blocks, and
the real gate (`verify-branch-merged.sh`) behaved correctly. But a confident,
specific, wrong warning trains the reader to discount the hook — and this is the
one hook whose entire value is making a human stop and think before a destructive
delete (the PR #520 incident class it was built for).

This is the same static-text-scan-vs-runtime-value limitation the git-safety
hardening chain (#663 → #664 → #665 → #666 → #677 → #678) worked through for the
`-C` / `--git-dir` extractors. Those landed on "crude but TOTAL beats smarter but
PARTIAL" for a _gate_; this is an _advisor_, so the right move is different —
don't try to resolve the variable, just stop claiming certainty you don't have.

## Acceptance Criteria

- [ ] When the extracted `REF` cannot be a literal branch name — it contains `$`,
      backtick, or an unbalanced quote — the hook emits an "unresolvable ref"
      warning instead of the "NO PR found" warning
- [ ] The unresolvable-ref message says the branch name could not be resolved
      from the command text and that merge state must be confirmed manually; it
      does NOT assert that no PR exists
- [ ] The existing `MERGED` / `OPEN` / `CLOSED` / unparseable / genuine-no-PR
      paths are unchanged for literal branch names
- [ ] Test coverage in `.claude/hooks/test-git-safety.sh` for a variable-quoted
      delete (`git branch -D "$B"`) and for a genuine no-PR literal branch,
      asserting the two produce _different_ messages

## Implementation Notes

- The relevant block is the `[ "$KIND" = "delete" ] && [ -n "$REF" ]` guard in
  `.claude/hooks/git-safety.sh` (~line 566). There is already a precedent for
  this shape directly above it: the `case "$REF" in -*)` flag-like check at ~569
  emits "Fresh PR check skipped: extracted ref looks like a flag — verify
  manually". Add a sibling case, do not restructure.
- Do NOT attempt to resolve the variable (no `eval`, no scanning earlier
  commands in the string for an assignment). Evaluating attacker-influenced
  command text inside a security hook is strictly worse than an honest
  "unknown". The goal is to downgrade a false certainty to a stated uncertainty.
- Note the flag-like `case` at ~569 currently warns but then falls through into
  the `gh pr view` call anyway — check whether the new case should `return`/skip
  the lookup, and whether the existing flag case has the same fall-through
  issue. If it does, that is in scope (same block, same bug shape).
- Keep it warn-only. This hook must never gain a deny path.

## Scope Contract

- **Mechanisms to use:** the existing `case "$REF"` guard pattern already in the
  same block, and the existing `warn` helper. No new helper, no shared library.
- **Files in scope:** `.claude/hooks/git-safety.sh`,
  `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- The quote/`$`/backtick detector must not false-positive on legitimate branch
  names. Git permits `$` in a ref name, so a branch genuinely named `feat/a$b`
  would newly get "unresolvable" instead of a real PR lookup. That trade is
  acceptable (a softer warning on a rare valid name beats a confidently wrong
  one on a common invocation), but note it in a comment so a later reader does
  not "fix" it back.
- Assert on message _identity_, not just exit status, in the tests — the whole
  defect is that the wrong branch of a warn-only hook was taken, which no exit
  code distinguishes.

## Updates

### 2026-07-26

- Initial creation. Observed during `/todo` Phase 5 cleanup after PR #720 merged;
  the hook contradicted `verify-branch-merged.sh` in the same command.
