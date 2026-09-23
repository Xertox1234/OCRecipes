---
title: "Finish PR #1019 (count table, wrapped-tag and line-citation finding shapes): check its review record + CI, merge, fast-forward main, remove the worktree"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [harness, review-gate]
github_issue:
---

# Finish PR #1019 — widened finding-line detection in the review stamp writer

## Summary

PR #1019 (branch `fix/finding-line-shapes`, head `9cb3da8b4645e5aafda5f9cad2eecf04b4a7b8fa`) is
the follow-up to #1018. It was parked on 2026-09-23 with its single review pass and CI in
flight, so the user could use the session for other work. Resume: read the result, merge if
clean, then tidy up.

## Background

- #1018 (merged `ce789846`) made the stamp writer count the top severity tag only on a
  FINDING line, so a clean review's prose no longer records as `findings`.
- #1018's two reviewers (both non-blocking) constructed real finding shapes that the first
  narrowing missed. Per the one-pass rule they were fixed in a follow-up PR, not on #1018's branch.
- #1019 widens the line-start pattern: table pipes, `(TAG)`, backticked tags, emoji, unicode
  bullets, `a)` markers, a `Severity:`/`File:` label, and `:L42`/`#L42`/`line 42` citations.
  - Tests 61-76 cover those shapes. Case 77 pins the one shape left open on purpose (residual
    7: a path with NO line number).
  - It also corrects the overclaiming comment and the stale sentence in the five
    `.claude/agents/*.md` reviewer definitions.
- Verified before parking:
  - Writer suite 111/111 under bash 5 and 3.2. Red-first: 16 of the 17 new rows failed before
    the change (case 77 is the pinned residual).
  - Full hook runner: 38 suites green.
  - `preflight:fast` stamp written for `9cb3da8b`.
- In flight at park time:
  - One `code-reviewer` pass, dispatched with the instruction to write `<TAG>` instead of the
    word, because the main checkout still ran the pre-#1018 writer.
  - CI on #1019.
- The main checkout was left 1 commit behind `origin/main` (#1018 not pulled). The user
  declined the fast-forward at park time.

## Acceptance Criteria

- [x] Read the review record at the head. It must say `clean` or `advisory`, with 0 unresolved
      and a digest equal to the output of
      `gh pr diff 1019 --name-only | shasum | cut -c1-16`. Check the file with
      `jq . /tmp/ocrecipes-review-stamps-*/9cb3da8b4645e5aafda5f9cad2eecf04b4a7b8fa/*.json`.
      If the record is missing (a reboot wipes `/tmp`) or reads `findings` only because the
      reviewer's prose used the severity word, dispatch ONE fresh `code-reviewer` using the
      `docs/AI_WORKFLOW.md` dispatch prompt. Never resume the old reviewer.
- [x] Any NON-blocking findings: file them, or fix them in a follow-up PR. Never fix on
      #1019's branch, because that moves the head and voids the record. Guard/hook findings go
      to `docs/harness-residuals.md`.
- [x] Check CI: `gh pr checks 1019`. All required checks must pass. The corpus job runs on
      this PR because it touches `.claude/hooks/**`; expect about 7 minutes.
- [x] Merge with `mcp__github__merge_pull_request` (squash, `expectedHeadSha` = the head
      above). Archive THIS todo in the same session.
- [x] Fast-forward the main checkout (`git pull --ff-only` on `main`), so the hooks run the
      new writer.
- [x] Remove the worktree: `git worktree remove .claude/worktrees/narrow-critical-detect`.
      Plain remove, not `--force`. Its branch is `fix/finding-line-shapes`, despite the
      worktree's name.

## Implementation Notes

- Files in #1019: `.claude/hooks/review-stamp-writer.sh`,
  `.claude/hooks/test-review-stamp-writer.sh`, and the five `.claude/agents/*.md` reviewer
  definitions.
- The one-pass rule and the advisory verdict are described in `docs/AI_WORKFLOW.md` →
  Review Policy.
- Context: memory `project_review_drag_cut_2026_09_22.md`.
- This todo file was written into the main checkout UNCOMMITTED at park time (a todos-only PR
  would cost a CI run). Commit or archive it together with the resume work.

## Updates

### 2026-09-23

- Parked by user request, with the review and CI still running. Their results were not
  known when this was written.
- CI finished GREEN at `9cb3da8b`: 17 SUCCESS, 1 SKIPPED (the nightly unsharded corpus, which
  is expected on a PR). The review result follows below when it lands.
- At compaction time NO review record existed yet under
  `/tmp/ocrecipes-review-stamps-07d4e12e42b1/9cb3da8b…/`, so the review was still running or
  wrote nothing. The expected file-list digest for #1019 is `cce88a85024fa34e`
  (7 files, per `gh pr diff 1019 --name-only`).
- The user reviewed the frozen harness list and kept it FROZEN (2026-09-23), so no guard
  hardening follows this todo.
- Resumed. No record existed at the head, so ONE fresh `code-reviewer` was dispatched. It
  recorded `advisory`, 0 unresolved, digest `cce88a85024fa34e` (matches). CI was green:
  17 SUCCESS, 1 SKIPPED.
- MERGED as `9c87c995` (squash). Main checkout fast-forwarded with the user's OK. Worktree
  `narrow-critical-detect` removed.
- The review's single WARNING was re-run and confirmed: a prose line that STARTS with the bare
  top tag word (followed by a space) still records `findings`. It is deny-only, and the
  comment's list of three renderings is narrower than the code. Recorded in
  `docs/harness-residuals.md` (hook finding, frozen), not fixed.
