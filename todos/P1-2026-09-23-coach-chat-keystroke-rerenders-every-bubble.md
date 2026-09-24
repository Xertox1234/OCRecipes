---
title: "Coach chat re-renders every visible bubble on each keystroke — handleSend depends on inputText and CoachChat is skipped by the React Compiler"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance]
github_issue:
---

# Coach chat re-renders every visible bubble on each keystroke — handleSend depends on inputText and CoachChat is skipped by the React Compiler

## Summary

Typing in Coach chat re-creates `renderItem` on every keystroke, so the FlatList re-renders every visible ChatBubble/BlockRenderer row. The component is skipped by the React Compiler, so its manual dependency arrays are the only memoization.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H3** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Chain: `handleSend` (CoachChat.tsx:383-423) reads `inputText` and lists it in deps → `handleRetry` (:425-456), `handleBlockAction` (:466-556), `handleQuickReply` (:676-688) depend on `handleSend` → `renderItem` (:690-770) depends on those → passed to `<FlatList renderItem>` (:912-916).
- Compiler bailout reproduced: `(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause` (the `finally` in `handleConfirmPlanSlot`). See M1 / the compiler-visibility todo.
- Research: `confirmed`. `useEffectEvent` is unavailable (React 19.1.0) and react.dev forbids it for event handlers — use a ref for the latest `inputText`. Re-enabling compilation alone would NOT fix this (the compiler would still key `handleSend` on `inputText`).

## Acceptance Criteria

- [ ] `handleSend` reads the latest input from a ref (updated in `handleChangeText` or at render) and no longer depends on `inputText`
- [ ] `renderItem` identity is stable across keystrokes (test: render, change input, assert the renderItem prop is referentially equal / row render count unchanged)
- [ ] Send, retry, quick-reply, and block actions behave identically (existing CoachChat tests stay green)
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Keep the change minimal: one `inputTextRef`. Do not restructure CoachChat's other handlers here.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/coach/CoachChat.tsx`
  - `client/components/coach/__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- CoachChat.tsx is 971 lines with extensive branch tests — run the full CoachChat test set.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H3).
