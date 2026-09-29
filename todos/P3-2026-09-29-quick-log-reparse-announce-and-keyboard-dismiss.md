---
title: "Quick Log: a second parse that replaces the items is not announced, and closing the drawer leaves the keyboard up"
status: backlog
priority: low
created: 2026-09-29
updated: 2026-09-29
assignee:
labels: [deferred, react-native, accessibility]
github_issue:
---

# Quick Log: re-parse announce and keyboard dismiss

## Summary

Two gaps left out of scope by #1175:

1. The success announcement fires only on the `hasParsedItems` false→true edge. A second parse that replaces the item list without it passing back through empty is never announced on VoiceOver. On TalkBack, #1175's `accessibilityLiveRegion="polite"` count text re-reads it only when the item count changes ("Found 1 item" → "Found 2 items"), so a same-count replace is silent there too.
2. Closing the Quick Log drawer never calls `Keyboard.dismiss()`, so the keyboard can stay up over the collapsed or locked row.

## Background

1. Found by #1175's code-reviewer, who built a probe to confirm it. #1175 keyed the announce on `hasParsedItems`, as its todo directed. A clean fix needs a per-parse signal from `client/hooks/useQuickLogSession.ts`, which was outside that todo's scope. The pattern is codified as the "Second manifestation" section of `docs/solutions/logic-errors/imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md`.
2. Found by #1175's mobile-reviewer. This predates #1175: every close path shares it (switching drawers, leaving the tab, a successful log), because `reset()` in `useQuickLogSession.ts` clears state but never dismisses the keyboard.

## Acceptance Criteria

- [ ] `useQuickLogSession` exposes a per-parse generation counter, bumped on every successful parse that sets items. Both `client/components/home/QuickLogDrawer.tsx` and `client/screens/QuickLogScreen.tsx` key their success announce on it, so every replace-parse is announced on both platforms: VoiceOver always, and TalkBack including a same-count replace. Don't double-announce a count-changing replace on Android, where the live region already covers it (`docs/rules/accessibility.md`). Tests drive parse → parse with no empty state in between, for both the same-count and changed-count cases, and assert the expected announces per platform. RED first.
- [ ] The existing announce guards stay silent on mount and on reset (keep the prev-value ref guard).
- [ ] Closing or resetting the Quick Log session dismisses the keyboard (`Keyboard.dismiss()` in `reset()` or at the drawer's close path, whichever covers every close path listed above). A test asserts it. RED first.

## Implementation Notes

- `client/hooks/useQuickLogSession.ts`: `parsedItems` state at ~line 66. `reset()` at ~line 399 bumps `sessionEpochRef` and clears state. Items are set on parse success at ~line 136 and ~line 162 (inside `handleTextSubmit`, ~line 151); bump the counter on both paths.
- Follow `docs/rules/accessibility.md`: an Android live region vs. an iOS imperative announce; don't double-announce.
- Read #1175's diff first (`QuickLogDrawer.tsx`, `QuickLogScreen.tsx`, and their tests) and build on its edge-guard.

## Scope Contract

- **Files in scope:** `client/hooks/useQuickLogSession.ts` + its test, `client/components/home/QuickLogDrawer.tsx` + `client/components/home/__tests__/QuickLogDrawer.test.tsx`, `client/screens/QuickLogScreen.tsx` + `client/screens/__tests__/QuickLogScreen.test.tsx`, `client/screens/HomeScreen.tsx` (only if the close path lives there).

## Dependencies

- #1175 must be merged first (this builds on its announce edge-guard).

## Updates

### 2026-09-29

- Auto-filed (Low) from #1175's review (code-reviewer WARNING and mobile-reviewer SUGGESTION).
