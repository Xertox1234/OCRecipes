---
title: "Coach Pro: token-budget-aware history truncation"
status: done
priority: low
created: 2026-04-23
updated: 2026-04-28
assignee:
labels: [coach, performance]
---

# Coach Pro: token-budget-aware history truncation

## Summary

The `handleCoachChat` function fetches a fixed 20-message history window. As tool-call payloads grow (full daily logs, recipe ingredient lists), this can cause `finish_reason: "length"` responses. Truncation should be token-aware, pruning older tool result messages first.

## Background

Noted as a deliberate deferral during the 2026-04-19 coach improvements plan (`docs/superpowers/plans/2026-04-19-coach-improvements.md` — "Deferred: Conversation History Window" section). The fixed cap is acceptable now; monitor production logs for `finish_reason: "length"` to know when to act.

The current fetch is in `server/services/coach-pro-chat.ts` — `storage.getChatMessages(conversationId, 20)`.

## Acceptance Criteria

- [ ] History passed to the OpenAI SDK never exceeds a configurable token budget (e.g. 8 000 tokens for context)
- [ ] Pruning strategy: drop oldest tool result messages first, then oldest assistant messages, preserve the most recent user message always
- [ ] `finish_reason: "length"` no longer appears in production logs for normal conversations
- [ ] Existing coach tests still pass; new unit test covers the truncation logic

## Implementation Notes

- Use `tiktoken` (or a simple char-based approximation: 1 token ≈ 4 chars) to estimate message sizes before passing to OpenAI
- Tool result messages (`role: "tool"`) are the largest; prune those first
- Keep at minimum: system prompt + last user message + last N assistant turns (configurable)
- Truncation function should be a pure utility in `server/lib/` so it is independently testable

## Dependencies

- None blocking — can be done independently of other coach work

## Risks

- Aggressive truncation could lose context the model needs (e.g. a tool result referenced two turns later)
- Token counting adds latency — keep the estimator cheap (char-based is fine as a starting point)

## Updates

### 2026-04-23

- Initial creation — deferred from coach improvements plan (PR #41)
