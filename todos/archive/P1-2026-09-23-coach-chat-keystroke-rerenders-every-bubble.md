---
title: "Coach chat re-renders every visible bubble on each keystroke — handleSend depends on inputText and CoachChat is skipped by the React Compiler"
status: done
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

- [x] `handleSend` reads the latest input from a ref (updated in `handleChangeText` or at render) and no longer depends on `inputText`
- [x] `renderItem` identity is stable across keystrokes (test: render, change input, assert the renderItem prop is referentially equal / row render count unchanged)
- [x] Send, retry, quick-reply, and block actions behave identically (existing CoachChat tests stay green)
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25

- Implemented: `inputTextRef` mirrors `inputText` every render (assigned directly in the render
  body, not inside `useEffect` — matches the existing `onCompleteRef` idiom in
  `client/camera/components/ScanSonarRing.tsx`); `handleSend` reads `inputTextRef.current` and no
  longer depends on `inputText`.
- Beyond the ref (Implementation Notes said "one `inputTextRef`"), AC #2 ("`renderItem` identity
  is stable across keystrokes") also required destructuring `mutateAsync` from
  `useDeleteChatMessageForRetry()` — that hook returns a raw `useMutation(...)` result, which
  spreads into a brand-new wrapper object on every render regardless of any keystroke. Since
  `handleRetry`'s `useCallback` deps held the whole `deleteChatMessage` object, that alone would
  have kept `renderItem` unstable even after the ref fix (measured: reverting just this destructure
  while keeping the ref fix made the regression test fail again). This mirrors the identical
  pre-existing pattern already used in the same file's `saveCatalogRecipe`/`addMealPlanItem`
  destructures — not a new mechanism.
- Added `client/components/coach/__tests__/CoachChat.render-item-stability.test.tsx`: intercepts
  the `react-native` `FlatList` export to capture the actual `renderItem` prop, asserts referential
  equality across two keystrokes, plus a denominator (input value updated, FlatList props object
  changed reference) proving each keystroke actually caused a re-render. Confirmed RED against the
  pre-fix code, GREEN after (both hunks; verified in isolation with mock stability held constant).
- Review: `code-reviewer` — no findings. `mobile-reviewer` — one WARNING (the new test lacked a
  denominator proving a keystroke actually caused a re-render); fixed inline (trivial, same test
  file). No second review round needed. Full suite green (546 files / 8688 tests), `check:types`
  clean, `lint` clean (0 errors).
- Residual, out of this todo's scope: `warmUpHook` (from `useCoachWarmUp()`) is a fresh object
  literal on every render of _its own_ caller, not `useMemo`'d — a parent re-render of CoachChat's
  caller (not merely a keystroke inside CoachChat) would still cascade a new `handleSend` identity
  through this same chain. Not observable from a keystroke alone, so out of scope for this fix;
  noted for anyone touching `useCoachWarmUp.ts` next.

### 2026-09-25 (review repair)

- Independent review found the render-body `inputTextRef.current = inputText` write is itself a React Compiler CompileError ("Cannot access refs during render"), confirmed by compiling an isolated component with the pinned `babel-plugin-react-compiler`. Replaced it with a `setInputText` wrapper that writes the ref and the state together (all three writes route through it); the isolated wrapper pattern compiles with no bailout. `docs/rules/hooks.md`'s ref-mirror rule now says so.
- The residual note was incomplete: `CoachProScreen`'s `handleCreateConversation` also depended on a fresh `useMutation` result. Both residuals are fixed here: `useCreateConversation` is destructured to `mutateAsync`, and `useCoachWarmUp` returns a memoized object (test added).
- Confirmation review: the wrapped setter isn't known-stable to `react-hooks/exhaustive-deps`, which raised 3 warnings. Listed it in the three dependency arrays (0 warnings now), noted this in the hooks rule, and made the comment say the file is already compiler-exempt for its `finally`.
