---
title: "Merge the per-command Bash hooks into one dispatcher to cut per-command overhead"
status: done
priority: low
created: 2026-10-23
updated: 2026-10-25
assignee:
labels: [harness, deferred, performance]
github_issue:
human_led: true
---

# Merge the per-command Bash hooks into one dispatcher to cut per-command overhead

## Summary

Every Bash tool call spawns several hook processes that each parse the same payload. One dispatcher that
parses once and calls each check as a function would make every shell command faster, with no CI cost.

## Background

Measured 2026-07-18 (memory `project_per_bash_hook_overhead.md`): 9 hook subprocesses per Bash call,
~60–75 ms script time, ≤140 ms end-to-end. The hook set has changed since (e.g. `guard-outward-cli.sh`,
`merge-review-guard.sh`, `guard-worktree-isolation.sh`, `session-coord-hook.sh`), so **re-measure
first**. The figure is from July.

Local only, so it adds no CI time. The hook test suites run in CI only on hook-touching PRs.

## Acceptance Criteria

- [x] Baseline: list every Bash-matched PreToolUse/PostToolUse entry in `.claude/settings.json`, and time
      each hook (3 runs each on a fixed payload set: a plain `ls`, a `git commit`, a `gh pr merge`).
      Record the total.
- [x] Decide go/no-go: proceed only if the measured saving is ≥ 30 ms per call. Otherwise close this todo
      with the numbers.
- [ ] If go: one PreToolUse dispatcher and one PostToolUse dispatcher read stdin once and run each existing
      check in the same order, with identical deny/allow output and exit codes.
- [ ] Each check still fails the same way as today (blocking guards fail closed, advisory hooks fail silent).
- [ ] Every existing `.claude/hooks/test-*.sh` suite passes unchanged, and `test-settings-hook-paths.sh` is
      updated for the new wiring.
- [ ] After timing is recorded in the PR body (same payload set).

## Implementation Notes

- Keep each check's logic in its own file. The dispatcher sources them or calls functions; don't
  inline everything into one script.
- Order matters: `rtk hook claude` is a global hook that rewrites commands. Confirm whether the dispatcher
  sees the rewritten or original command, and keep that the same as today.
- Self-modification of guards: auto mode must be OFF.

## Scope Contract

- **Mechanisms to use:** existing hook scripts and `.claude/hooks/lib/*`; one new dispatcher script per
  event.
- **Files in scope:** `.claude/settings.json`, `.claude/hooks/*.sh` (Bash-matched hooks only), a new
  `.claude/hooks/bash-dispatch-pre.sh` / `bash-dispatch-post.sh`, `.claude/hooks/test-settings-hook-paths.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Auto mode OFF.

## Risks

- A dispatcher bug can silently disable every guard at once. Add a test that each guard still denies its
  own canonical deny case through the dispatcher.

## Updates

### 2026-10-23

- Created from the harness-effectiveness review.

### 2026-10-25 — closed, no-go (measured)

- **Baseline.** Bash-matched hooks today: 10 project PreToolUse (`branch-preflight`, `core-bare-guard`,
  `drift-detect`, `nudge-dependency-add`, `pr-preflight-guard`, `git-safety`, `guard-outward-cli`,
  `merge-review-guard`, `checkpoint`, `session-coord-hook consult`) plus the global `rtk hook claude`;
  4 PostToolUse (`drift-detect-update`, `commit-verify`, `pr-verify`, `session-coord-hook record`).
  Each hook timed on the fixed payloads, median of 5 runs, bash 5.3.15, Mac16,13 (`gh` stubbed so
  `pr-verify`'s read-back adds no network time):

  | Payload       | Pre SUM | Pre MAX (slowest hook)       | Post SUM | Post MAX                |
  | ------------- | ------- | ---------------------------- | -------- | ----------------------- |
  | `ls -la`      | 146 ms  | 25 ms (`checkpoint`)         | 36 ms    | 10 ms                   |
  | `git commit`  | 246 ms  | 50 ms (`branch-preflight`)   | 112 ms   | 51 ms (`commit-verify`) |
  | `gh pr merge` | 372 ms  | 183 ms (`guard-outward-cli`) | 71 ms    | 43 ms (`pr-verify`)     |

  A fast-path hook costs ~10 ms per process; bare bash + one jq parse is ~5 ms.

- **Why no-go.** The hooks reference says "When an event fires, its matching hooks run in parallel."
  (https://code.claude.com/docs/en/hooks, "Hook handler fields", read 2026-10-25). So a call waits
  for the slowest hook (the MAX column), not the sum. One dispatcher running the checks in order
  would cost roughly SUM minus the ~9 saved process starts (~45–90 ms): about 60 / 160 / 290 ms
  against today's 25 / 50 / 183 ms. The July premise (9 hooks, ~60–75 ms summed) assumed the
  costs add up. A dispatcher saves CPU but makes every call slower, so the ≥ 30 ms saving bar
  is not met in any payload.
- **Where real time goes, for a future look (not filed):** `guard-outward-cli` on `gh pr merge`
  (183 ms) sets the wall time for that call. The hooks' `if` field (permission-rule syntax,
  e.g. `"Bash(git *)"`) can skip spawning a hook that has nothing to check. It cuts CPU, not
  wall time, since the slowest hook still runs.
- Bench script: session scratchpad `hookbench/bench.sh` (not committed).
