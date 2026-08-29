---
title: "guard-outward-cli.sh: fix 3 stale comments left behind by the cmd_words migration"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# guard-outward-cli.sh: fix 3 stale comments left behind by the cmd_words migration

## Summary

Three comments in `guard-outward-cli.sh` describe pre-PR-#850 behavior that the PR's
own code changes made false, risking a future maintainer trusting the comment and
reintroducing a bypass while "fixing" a perceived discrepancy.

## Background

Surfaced in the `/code-review` of PR #850 ("Angle B removed-behavior auditor"):

1. **Lines 210-216 & 224** (docstring above `gh_pr_clause_has_repo`): still claims the
   function reads "RAW $CMD, not $BARE" / "in the RAW command", but the PR switched the
   function body — and its callers (lines 593, 624) — to read `$WORDS` exclusively. A
newer paragraph explaining the real (`$WORDS`) behavior was appended below, but the
   original `$CMD`/`$BARE`/"RAW command" paragraph was left in place, so the function
   now carries two contradictory rationales.
2. **Line 453** (comment above the `eas build --auto-submit` check): says the flag check
   "DELIBERATELY scans raw $CMD, not $BARE", but the actual code scans a newline-joined
   dual rendering of BOTH `$CMD`AND`$WORDS`— exactly like the`--admin` check just
   below it, whose comment WAS correctly updated. This paragraph was never touched even
   though the code it describes was.

## Acceptance Criteria

- [x] The `gh_pr_clause_has_repo` docstring's stale `$CMD`/`$BARE`/"RAW command"
      paragraph is removed or corrected to match the actual `$WORDS`-only behavior;
      keep only the accurate newer paragraph.
- [x] The `--auto-submit` check's comment is corrected to describe the actual
      `$CMD`+`$WORDS` dual-scan, matching the `--admin` check's comment style.
- [x] No code changes — this is a comment-only fix; `test-guard-outward-cli.sh` stays
      green with zero behavioral diff.

## Implementation Notes

Read the current comments at `.claude/hooks/guard-outward-cli.sh` around the
`gh_pr_clause_has_repo` docstring and the `--auto-submit` check before editing — line
numbers may have shifted since this todo was filed (PR #850's bug fixes touched the
same file).

## Scope Contract

- **Mechanisms to use:** comment edits only, no logic changes.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- None — doc-only change.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` "Angle B removed-behavior auditor" findings.

### 2026-08-28

- Implemented both listed comment corrections (`gh_pr_clause_has_repo` docstring,
  `--auto-submit` check). `code-reviewer` found the title's implied 3rd stale
  comment — the Background section only enumerated 2 — at the `--admin` check
  (line ~596): "DELIBERATELY scans the RAW $CMD (not $BARE/$CLAUSE)" directly
  contradicted the accurate "Scans BOTH renderings" paragraph a few lines below
  it and the code's actual `$CMD`+`$WORDS` dual scan — the same defect class,
  in the same file, now more misleading because this todo's own new comments
  cite that block as "the accurate reference." Fixed inline (same file, few
  lines, no new mechanism). Verified comment-only via
  `git diff -U0 | grep -vE '^[+-][[:space:]]*#'` (empty) and
  `test-guard-outward-cli.sh` (248/248 pass, unchanged before/after).
