---
title: "Back button: make every pushed screen use the native glass pill (QA sweep #66)"
status: backlog
priority: low
created: 2026-10-19
updated: 2026-10-19
assignee:
labels: [deferred, ui, qa-sweep]
github_issue:
---

# Back button: make every pushed screen use the native glass pill (QA sweep #66)

## Summary

Some screens show the back button as a rounded glass pill (Pantry, Favourites) and others as plain "‹ Back" text (Profile → Settings), even inside one stack. The owner decided on 2026-10-19 that the glass pill is the style everywhere. The cause was not found, so PR #1520 made no change for this item.

## Background

This item carries over from `todos/archive/P3-2026-10-18-screen-chrome-consistency-followups-from-qa-sweep.md` (#66). The executor ruled out the obvious candidates by reading code only; it had no simulator run.

- `client/hooks/useScreenOptions.ts` sets one `headerBackTitle` for every stack, so it is the same everywhere.
- Settings, SavedItems, SignInMethods and CookbookCreate call `navigation.setOptions({ headerBackVisible: !isOpen })`. Pantry makes the same call and still shows a pill, so that call alone does not explain the difference.

## Acceptance Criteria

- [ ] The cause of pill vs plain text is found with evidence: a simulator screenshot of each style, plus the option that differs between the two screens.
- [ ] The fix goes in shared screen options or in the cause itself, not in a custom `headerLeft` on each screen.
- [ ] Settings, Favourites, Pantry and one Plan-stack screen all show the glass pill on the iOS Simulator.
- [ ] Re-checked in light and dark mode.

## Implementation Notes

- Start by comparing the effective options of the Settings and Favourites screens in `client/navigation/ProfileStackNavigator.tsx`: per-screen `options`, `setOptions` calls, `headerTransparent`, `headerLargeTitle`, `headerBlurEffect`, and any `headerLeft` or `headerBackButtonDisplayMode` set on the way.
- Use `/verify-ui` (iOS Simulator) on each screen before and after the fix.
- Related solution: `docs/solutions/logic-errors/function-headertitle-leaks-route-name-into-ios-back-button-2026-10-02.md`.

## Scope Contract

- **Mechanisms to use:** native-stack screen options (`useScreenOptions`, per-screen `options`/`setOptions`).
- **Files in scope:** `client/hooks/useScreenOptions.ts`, `client/navigation/*StackNavigator.tsx`, the screens that call `setOptions` on their header, and their `__tests__`.
- No custom back-button component.

## Dependencies

- An iOS Simulator run with the dev-client build.

## Risks

- The difference may come from iOS itself (for example, a transparent header vs an opaque one). If so, it may not be fixable without changing a header's background.

## Updates

### 2026-10-19

- Filed from the PR #1520 review, with the owner's decision recorded (glass pill everywhere).
