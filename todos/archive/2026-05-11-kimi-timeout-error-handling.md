---
title: "kimi scripts: add clean error handling on timeout for ask-kimi, kimi-write, kimi-challenge"
status: done
priority: low
created: 2026-05-11
updated: 2026-05-15
assignee:
labels: [tooling, kimi]
github_issue:
---

# kimi scripts: add clean error handling on timeout

## Summary

`ask-kimi`, `kimi-write`, and `kimi-challenge` will dump a raw `openai.APITimeoutError` traceback when the 90s API timeout fires. `kimi-review` already has a clean `try/except` that prints `[ERROR: kimi-review request failed: ...]` and exits 1. The other three should match.

## Background

Fixed in 2026-05-11 kimi hang audit session. `timeout=90.0` was added to all scripts but only `kimi-review` got the error handler since it runs as a background hook where silent/ugly failures cause confusion.

## Acceptance Criteria

- Wrap `client.chat.completions.create()` in `try/except Exception as e` in each script
- Print `[ERROR: <script-name> request failed: {e}]` to stderr
- Exit with code 1
- Files: `~/.local/bin/kimi-write`, `~/.local/bin/kimi-challenge`
- Also update source file `~/.local/share/claude-coworker/tools/kimi-write`
- Note: `ask-kimi` (both copies) already fixed in 2026-05-11 review pass

## Updates

### 2026-05-14

- Status set to `blocked` (was `backlog`) — all target paths are outside the repo (`~/.local/bin/`, `~/.local/share/claude-coworker/`), so the `/todo` skill cannot dispatch this work via a git worktree. Treat as a personal-tooling todo to be done manually when convenient.

### 2026-05-15

- Done. Wrapped `client.chat.completions.create()` in `try/except Exception as e` in all three files (`~/.local/bin/kimi-write`, `~/.local/bin/kimi-challenge`, `~/.local/share/claude-coworker/tools/kimi-write`); each prints `[ERROR: <script> request failed: {e}]` to stderr and exits 1, matching the `ask-kimi`/`kimi-review` pattern.
- Executed directly by the `/todo` orchestrator (not a worktree executor) since the targets are outside the repo. Verified: `py_compile` clean on all three; forced-failure run against an unreachable URL printed the clean error line and exited 1 — no traceback.
