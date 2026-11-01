---
title: "Decide the OpenAI SDK retry count for OpenRouter and Vertex clients"
status: backlog
priority: low
created: 2026-10-29
updated: 2026-10-31
assignee:
labels: [deferred, ai]
github_issue:
---

# Decide the OpenAI SDK retry count for OpenRouter and Vertex clients

## Summary

No AI client sets `maxRetries`, so every call can make 3 attempts at the primary and 3 more at the fallback, re-billing each.

## Background

Residual of audit finding M-rel-2 (the missing timeouts were fixed in ffb2611b). `server/lib/ai-client.ts` (~582) and `server/lib/vertex-client.ts` (~42); openai 6.39 defaults `maxRetries ?? 2`. With the circuit breaker and fallback already in place, SDK retries multiply latency (~6× nominal timeout) and cost during an upstream incident. A tuning choice for the owner.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [x] Owner picks maxRetries (0 or 1) per client — 0 for both (2026-10-31)
- [ ] Both client constructors set it; a test asserts the option

## Implementation Notes

Per-request `maxRetries` overrides the client value if a row needs more.

## Scope Contract

- **Files in scope:** `server/lib/ai-client.ts`, `server/lib/vertex-client.ts` and their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-10-31

- Owner ruling: `maxRetries: 0` on BOTH clients (OpenRouter `ai-client.ts` and Vertex `vertex-client.ts`). The fallback provider is the retry; no per-row overrides unless a row is shown to need one.
