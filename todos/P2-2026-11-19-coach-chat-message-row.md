---
title: "Pull CoachChat's per-message derivation into deriveMessageView + CoachMessageRow"
status: backlog
priority: medium
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, client, coach]
github_issue:
---

# Pull CoachChat's per-message derivation into deriveMessageView + CoachMessageRow

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`client/components/coach/CoachChat.tsx` grew 1229 → 1443 lines. Its `renderItem` (`:1013-1183`) derives per-message state inline (`hasFinderBlock`, `isHeld`, `blocksForMsg`, `isRetryTarget`, `memoryRefIds`, `savedRecipeId`) before rendering. (The audit agent's claim that CoachChat shares error-once / voice refs with ChatScreen was checked and is false — CoachChat has neither.)

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [ ] Pure `deriveMessageView(msg, ctx)` in the existing `client/components/coach/coach-chat-utils.ts`, with Vitest cases for each derived flag
- [ ] A memoised `<CoachMessageRow>` renders one message from that view
- [ ] `renderItem` shrinks to a call; streaming state stays out of its deps (docs/rules/hooks.md)
- [ ] No visible or VoiceOver change

## Implementation Notes

- Check React Compiler coverage of CoachChat before relying on manual memo.
- Review: mobile-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** client/components/coach/CoachChat.tsx, client/components/coach/coach-chat-utils.ts, client/components/coach/CoachMessageRow.tsx, their **tests**
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).
