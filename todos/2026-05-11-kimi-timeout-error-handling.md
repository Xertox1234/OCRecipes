---
title: "kimi scripts: add clean error handling on timeout for ask-kimi, kimi-write, kimi-challenge"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
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
