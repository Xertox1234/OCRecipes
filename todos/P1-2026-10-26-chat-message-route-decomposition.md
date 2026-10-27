---
title: "Decompose the 690-line chat send-message route handler"
status: in-progress
priority: high
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, server]
github_issue:
---

# Decompose the 690-line chat send-message route handler

## Summary

`POST /api/chat/conversations/:id/messages` is one ~690-line inline handler; split it so each job has one owner and the SSE size cap exists once.

## Background

Audit finding H1. The handler (`server/routes/chat.ts:281-970`) validates input, resolves the conversation type through 19 `isRecipeChat`/`isRemixChat` ternary uses (featureKey, label, dailyLimit, 429 text, stream branch), admits the turn (finder entry + quota), sets up SSE, runs two different streaming loops — each with its own copy of the `SSE_MAX_RESPONSE_BYTES` check (`:729`, `:856`) — and settles refund-vs-persist.

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] A `conversationType`-keyed config table replaces the ternary chains for featureKey / featureLabel / dailyLimit / limit message / stream function
- [ ] The handler body is split into `admitTurn()`, `streamRecipeTurn()`, `streamCoachTurn()` and an SSE sink that owns write + byte cap + abort/timeout; the byte-cap block exists once
- [ ] `server/routes/chat.ts` is under 600 lines (helpers in `server/routes/chat-stream.ts` or a service module)
- [ ] Quota / TOCTOU / refund semantics are byte-for-byte unchanged — `server-reviewer` + `security-auditor` review
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Pass the settle-phase closure state (`streamedContent`, `aborted`, `alreadyPersisted`) as one small mutable `TurnState` object rather than as parameters. Keep the route registration name `register`. Re-read docs/rules/api.md and docs/rules/architecture.md before starting.

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `server/routes/chat.ts`, one new `server/routes/chat-stream.ts` (or `server/services/chat-turn.ts`), `server/routes/__tests__/chat*.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Quota/refund logic is money-adjacent (daily generation limits): a reordering bug double-charges or never refunds. Pin each settle path with a test before moving it.
- SSE abort/timeout ordering is subtle — keep the existing event order exactly.

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit
