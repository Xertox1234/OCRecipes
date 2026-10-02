---
title: "Home: the keyboard covers an inline drawer's input when the page is short"
status: in-progress
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, react-native, ux]
github_issue:
---

# Home: the keyboard covers an inline drawer's input when the page is short

## Summary

On Home, opening an inline drawer that takes text (Quick Log, Search Recipes) and tapping its
input can leave the input and its buttons under the keyboard. Keep the focused input above
the keyboard.

## Background

Seen on the iPhone 17 simulator on 2026-09-26 while verifying the Quick Log fixes. With only
a couple of sections showing rows, the Home page is short. Opening Quick Log glides its row
toward the top, but `scrollTo` cannot scroll past the end of the content, so the row barely
moved. After tapping the input, the keyboard covered the input and the new "Find food"
button. A tap aimed at the button hit a keyboard key.

- `client/screens/HomeScreen.tsx` has no keyboard avoidance (no `KeyboardAvoidingView`,
  keyboard-aware scroll view, or keyboard inset in the scroll content).
- `glideRowToTop` (same file) computes the offset with `glideToTopOffset`, and the native
  scroll clamps it to the content height.
- Returning submits and blurs, so results are reachable after submit. The problem is while
  typing.

Deferred from the Quick Log lock + submit UX branch (`feat/quicklog-lock-and-submit-ux`)
because it affects every Home inline drawer, not just Quick Log.

## Acceptance Criteria

- [ ] With a short Home page (most sections collapsed), opening Quick Log or Search Recipes
      and focusing its input keeps the input and its buttons above the keyboard (simulator
      screenshot as evidence).
- [ ] Long pages keep today's behavior: the row glides to just under the collapsed header.
- [ ] No layout jump when the keyboard hides.
- [ ] A test covers whatever pure logic the fix adds (e.g. the extra bottom inset while the
      keyboard is up); the scroll itself is verified on the simulator.

## Implementation Notes

- Likely shape: while the keyboard is up, pad the scroll content's bottom by the keyboard
  height, so the glide has room to lift the row. Or use the project's
  `KeyboardAwareScrollViewCompat` (`client/components/`) if it fits the animated
  `Animated.ScrollView` + `useScrollLinkedHeader` setup. Check how other screens with inputs
  in scroll views handle it first.
- Re-run the glide after the keyboard shows (its height changes the maximum offset).
- Keep `FAB_CLEARANCE` / tab-bar padding in the calculation.

## Scope Contract

- **Mechanisms to use:** an existing keyboard-aware pattern in the repo, or a keyboard-height
  bottom inset. Nothing new beyond that.
- **Files in scope:**
  - `client/screens/HomeScreen.tsx`
  - `client/screens/__tests__/HomeScreen.test.tsx`
  - a pure helper next to `glideToTopOffset`, if one is needed, and its test
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-09-26

- Filed while verifying the Quick Log fixes on the simulator.
