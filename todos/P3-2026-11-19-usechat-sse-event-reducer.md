---
title: "Replace useChat's handleEvent if-chain with a pure applyChatSseEvent"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, client, chat]
github_issue:
---

# Replace useChat's handleEvent if-chain with a pure applyChatSseEvent

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`client/hooks/useChat.ts` (883 lines): `handleEvent` (`:533-650`) is a 120-line chain of independent `if (data.x)` branches inside `sendMessage`, each dual-writing a ref and a state (`streamingRecipeRef.current = …` ×5).

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [ ] One stream ref object + a single `publish()` to state
- [ ] Pure `applyChatSseEvent(stream, data) -> { stream, effects }` with Vitest cases per event type
- [ ] Effects (query invalidation, notify) run in the hook; 16 ms flush timer and epoch check unchanged

## Implementation Notes

- Overlaps the shared SSE transport from the 2026-10-26 audit — reuse it, don't fork.
- Review: mobile-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** client/hooks/useChat.ts, client/hooks/chat-sse-event.ts, related tests
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).
