---
title: "chat-admit admitTurn has no direct unit tests"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, code-quality, testing]
github_issue:
---

# chat-admit admitTurn has no direct unit tests

## Summary

CQ12: `server/routes/chat-admit.ts` `admitTurn` gates the daily limit and finder-action dedup; only indirect coverage via the chat route tests.

## Acceptance Criteria

- [x] `server/routes/__tests__/chat-admit.test.ts` covers each early-return branch (stale action quiet no-op, duplicate tap, limit reached, admitted path, offer flag)
- [x] No production code change unless a test exposes a real defect

## Scope Contract

- **Files in scope:** new test file only (plus production fix if a test exposes a defect — disclose it)
