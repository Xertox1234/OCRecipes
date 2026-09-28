---
title: "Session coordination: a symlinked path spelling records rel_path as the full absolute path"
status: backlog
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

- [ ] A single normalization point, e.g. in `target_paths` or at the top of `record_one`/`consult_match`, rewrites a target to its physical spelling (`cd "$existing_ancestor" && pwd -P` plus the remaining suffix). Recorded `abs_path` and consulted paths then agree, whichever spelling each session used.
- [ ] `rel_path` is derived from the normalized path, so it is never equal to `abs_path` for a file inside a git worktree.
- [ ] Tests in `.claude/hooks/test-session-coord-v2.sh`:
  - a repo reached via a symlinked directory records the correct `rel_path`;
  - a consult using the other spelling reports "same checkout";
  - a control shows the real spelling still matches.

## Implementation Notes

- Files: `scripts/pg-lab/session-coord.sh` (`record_one`, `consult_match`, possibly `target_paths`), `.claude/hooks/test-session-coord-v2.sh`.
- The walk-up loop (`while [ ! -d "$dir" ] …`) already finds the nearest existing ancestor. Normalize that ancestor with `pwd -P`, then re-append the non-existent suffix.
- Do not canonicalize `..` segments beyond what `pwd -P` does for the existing ancestor. The write-target parser documents that paths are compared as spelled.
