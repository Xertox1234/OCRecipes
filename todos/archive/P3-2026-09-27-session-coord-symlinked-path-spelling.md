---
title: "Session coordination: a symlinked path spelling records rel_path as the full absolute path"
status: done
priority: low
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [deferred, harness]
github_issue:
---

# Session coordination: a symlinked path spelling records rel_path as the full absolute path

## Summary

`record_one` and `consult_match` in `scripts/pg-lab/session-coord.sh` compute `rel="${file#"$root"/}"`, where `root` comes from `git rev-parse --show-toplevel`. git returns the **physical** spelling (`/private/tmp/...` on macOS). If the file path uses a symlinked spelling (`/tmp/...`), the prefix strip does nothing: `rel_path == abs_path`. The two sessions' `abs_path`s also differ by spelling, so neither the same-checkout match nor the cross-worktree match fires. The result is a false negative: no warning.

## Background

The Task 7 review of session coordination v2 (PR 2, `feat/coord-visibility-bash`) found this. Its reproduction: a repo reached via `/tmp/...` versus `/private/tmp/...` recorded `rel_path` equal to the full absolute path. The strip is pre-existing (PR 1's `do_record`), and the plan reproduced it verbatim. Before PR 2 only Edit/Write `file_path`s reached it, and those almost always sit inside the real checkout under `/Users/...`. PR 2 widens the surface: a Bash target can be any absolute path typed into a command. Exposure in this repo is still low, because worktrees live under `/Users/...` and are not symlinked. It fails safe, as a missed warning, never as a false block or lost data.

Deferred rather than fixed in PR 2: a correct fix normalizes the spelling of `abs_path` and `rel_path` at one choke point, which is a small design change and outside that PR's tasks.

## Acceptance Criteria

- [x] A single normalization point, e.g. in `target_paths` or at the top of `record_one`/`consult_match`, rewrites a target to its physical spelling (`cd "$existing_ancestor" && pwd -P` plus the remaining suffix). Recorded `abs_path` and consulted paths then agree, whichever spelling each session used.
- [x] `rel_path` is derived from the normalized path, so it is never equal to `abs_path` for a file inside a git worktree.
- [x] Tests in `.claude/hooks/test-session-coord-v2.sh`:
  - a repo reached via a symlinked directory records the correct `rel_path`;
  - a consult using the other spelling reports "same checkout";
  - a control shows the real spelling still matches.

## Implementation Notes

- Files: `scripts/pg-lab/session-coord.sh` (`record_one`, `consult_match`, possibly `target_paths`), `.claude/hooks/test-session-coord-v2.sh`.
- The walk-up loop (`while [ ! -d "$dir" ] …`) already finds the nearest existing ancestor. Normalize that ancestor with `pwd -P`, then re-append the non-existent suffix.
- Do not canonicalize `..` segments beyond what `pwd -P` does for the existing ancestor. The write-target parser documents that paths are compared as spelled.

## Updates

### 2026-09-29

- Implemented: added `physical_path()` to `scripts/pg-lab/session-coord.sh`, wired into `target_paths()` — the single choke point feeding both `do_record` and `do_consult`, so `record_one`/`consult_match` needed no changes. Normalizes before the Bash branch's `sort -u` so two spellings of one real file collapse to one consult candidate.
- Added the three pinned cases plus a mutant to `.claude/hooks/test-session-coord-v2.sh`.
- Also fixed `.claude/hooks/test-session-coord.sh`: its pre-existing "Level 1" fixture used a literal, never-created `/tmp/checkout-a/...` path that the new normalization broke (mirrored the file's own Level 2 fix for the identical class of mismatch), and a review WARNING flagged a second fixture ("self-suppression") the same normalization made vacuous — fixed the same way, verified with a hand-built `is_self` mutant.
- `scripts/preflight.sh --fast --uncommitted` and the Step 5b npm commands were denied by the auto-mode classifier this session ("Interfere With Workloads" — other concurrent sessions were active). No `.ts`/`.tsx`/`.js` files are touched by this diff; verification instead ran the three hook self-test suites that exercise `session-coord.sh` directly, with the runner's own env strip: `test-session-coord-v2.sh` (70 assertions — 66 on the base plus 4 new, ALL PASS, 17/17 mutants killed), `test-session-coord.sh` (ALL PASS), `test-drift-detect.sh` (36/36 PASS, unaffected).
- Review: `code-reviewer`, one pass, `No blocking findings.` (advisory) with one WARNING (fixed inline, see above).
