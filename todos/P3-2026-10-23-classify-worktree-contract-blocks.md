---
title: "Sort the worktree-contract guard's real-world blocks into real catches and false alarms"
status: backlog
priority: low
created: 2026-10-23
updated: 2026-10-23
assignee:
labels: [harness, deferred]
github_issue:
---

# Sort the worktree-contract guard's real-world blocks into real catches and false alarms

## Summary

The worktree-contract guard blocked 39 tool calls in 12 sessions since 2026-10-12. We don't know how
many were real catches. Sort them, as was done for the outward-CLI guard, so any fix rests on evidence.

## Background

From the 2026-10-23 harness review (796 transcript files since 2026-10-12, each blocked tool call
counted once): `Worktree contract violation` = **39 blocks, 12 sessions, one session with 10**. The
messages come in two kinds: "a mutating git command would run against <main>" and "a write-shaped
command targets <main>". It's not known how many stopped a real write to the main checkout and how many
blocked legitimate work, such as `/audit` writing to main by design, memory-dir writes, or `/usr/bin/git`
reads.

This is analysis only. It changes no guard and costs no CI time.

## Acceptance Criteria

- [ ] A script in the scratchpad joins each denied `tool_result` containing `Worktree contract violation`
      to its `tool_use` command (dedup by `tool_use_id`) and reports the denominator: files scanned,
      unique blocks, and distinct sessions.
- [ ] Each block is labelled `real-catch` (it would have mutated the main checkout from a contracted worktree
      session), `false-alarm` (blocked legitimate work), or `unclear`, with a one-line reason.
- [ ] The 10-block session is explained: one recurring cause, or several.
- [ ] Results are written up in the reply or a short note. If false alarms ≥ real catches, file a follow-up todo
      with the commands as a fixture corpus (same shape as
      `todos/P2-2026-10-23-outward-cli-guard-false-alarms-help-and-prose.md`). Otherwise record "working
      as intended" in `docs/harness-residuals.md`.

## Implementation Notes

- Reuse the scratchpad parser pattern from the 2026-10-23 review: walk every `*.jsonl` under
  `~/.claude/projects/-Users-williamtower-projects-OCRecipes/` (including subagent subdirs), map
  `tool_use.id → input.command`, and keep `tool_result` blocks with `is_error` containing the needle.
- Show the full command, not a 160-char prefix. Most outward-CLI false alarms were only visible past
  the prefix.
- Never point a kimi script at this (transcripts may contain auth/health context).

## Scope Contract

- **Mechanisms to use:** a throwaway script in the session scratchpad; no repo code.
- **Files in scope:** `docs/harness-residuals.md` (only if recording the outcome), plus a new todo file if
  warranted.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Transcript text may echo the same block several times. Dedup by `tool_use_id`, never by line count.

## Updates

### 2026-10-23

- Created from the harness-effectiveness review. Owner plans to do this next session alongside the
  outward-CLI false-alarm todo.
