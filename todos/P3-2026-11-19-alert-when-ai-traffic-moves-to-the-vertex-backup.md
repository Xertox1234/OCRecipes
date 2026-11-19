---
title: "Report once to Sentry when the OpenRouter breaker opens and AI traffic moves to Vertex"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, reliability, observability, ai]
github_issue:
---

# Report once to Sentry when the OpenRouter breaker opens and AI traffic moves to Vertex

## Summary

A sustained OpenRouter outage that falls back to Vertex shows only as `warn "ai call using fallback"` log lines. Sentry hears only on 402, config errors, or both routes failing. All traffic can quietly move to Vertex's capacity and cost.

## Background

Reliability audit 2026-11-19, finding L-obs-4 (`docs/audits/2026-11-18-reliability.md`), reported as a suggestion. Owner triage: todo.

## Acceptance Criteria

- [ ] One throttled `deps.report` when the OpenRouter breaker opens, naming the failure kind only (no prompt or user data).
- [ ] Test: breaker opening reports once per throttle window; per-call fallbacks still only log.

## Implementation Notes

- `server/lib/ai-client.ts:~590` (fallback log); `throttledReport` already exists there.

## Scope Contract

- **Files in scope:** `server/lib/ai-client.ts` and its test.

## Dependencies

- None

## Risks

- Noise: keep it throttled.

## Updates

### 2026-11-19

- Filed from the reliability audit (L-obs-4).
