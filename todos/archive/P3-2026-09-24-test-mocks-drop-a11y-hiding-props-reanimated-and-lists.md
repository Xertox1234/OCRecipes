---
title: "Reanimated and FlatList/SectionList test mocks don't translate accessibility-hiding props, so hiding on those components can't be tested"
status: done
priority: low
created: 2026-09-24
updated: 2026-10-02
assignee:
labels: [deferred, testing, accessibility]
github_issue:
---

# Test mocks drop or pass through accessibility-hiding props (reanimated + lists)

## Summary

`ariaHiddenProps` in `test/mocks/react-native.ts` turns RN's hiding props into `aria-hidden` for
plain primitives, but two other mock families skip it, so no jsdom test can check hiding there.

## Background

Both gaps are documented in
`docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`
(gap 1 since PR #1040; gap 2 and the extra gap-1 sites added by PR #1043). The site lists below
are examples as of 2026-09-24, not a census:

1. `test/mocks/react-native-reanimated.ts` — `mapA11yProps()` destructures neither
   `accessibilityElementsHidden` nor `importantForAccessibility`, so they reach the DOM raw with a
   React unknown-prop warning. Example sites: ProfileScreen, HomeScreen, CookbookCoverPlate,
   ProductChip, BatchScanScreen, CollapsibleSection.
2. `createFlatListMock` and the hand-written `SectionList` in `test/mocks/react-native.ts`
   destructure a fixed prop list and never spread the rest, so the props are silently dropped.
   Example sites (via `behindContentA11yProps`): SavedItemsScreen, ChatListScreen,
   CookSessionReviewScreen, GroceryListsScreen, PantryScreen.

## Acceptance Criteria

- [x] `mapA11yProps()` routes the two hiding props through `ariaHiddenProps` (import it from
      `./react-native`, the reuse pattern `test/mocks/gorhom-bottom-sheet.ts` uses)
- [x] The FlatList and SectionList mocks apply `ariaHiddenProps` to their root element
- [x] One test per mock family shows the prop now yields `aria-hidden="true"` and fails if the
      mapping is removed
- [x] Full client suite stays green; fix any test that relied on the old raw/dropped behaviour
- [x] Update the solution doc: mark both gaps closed and remove the per-site lists

## Implementation Notes

- Files: `test/mocks/react-native-reanimated.ts`, `test/mocks/react-native.ts`, one new
  `__tests__` file (or extend `client/components/__tests__/Card.a11y.test.tsx`), the solution doc.
- `CollapsibleSection.tsx` also passes a literal `aria-hidden`; make sure the translated value and
  the literal don't conflict.

## Scope Contract

- **Mechanisms to use:** the existing `ariaHiddenProps` helper.
- **Files in scope:** the two mock files, their tests, the solution doc, and any existing client
  test that AC 4 requires repairing (list each one in the Updates entry).
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from the #1040 / #1043 reviews.

### 2026-10-02

- Implemented. `mapA11yProps()` (`test/mocks/react-native-reanimated.ts`), `createFlatListMock`
  and `SectionList` (`test/mocks/react-native.ts`) now route `accessibilityElementsHidden` /
  `importantForAccessibility` through `ariaHiddenProps`; the list mocks still do not spread
  `...rest`. New contract test `test/mocks/__tests__/a11y-hiding-props.test.tsx` (40 tests).
  Red-first: 22 of the 40 failed on the old mocks (15 hidden rows, 6 raw-leak rows, 1
  literal-vs-pair row) while all 15 not-hidden control rows passed; every single-prop arm was
  mutation-checked (dropping one prop's forward reddens exactly that prop's rows). The solution
  doc marks both gaps closed and the per-site lists are gone.
- Existing client tests repaired under AC 4 — one file:
  `client/screens/__tests__/HomeScreen.test.tsx`. Its 8 TalkBack background-trap tests read the
  raw `importantforaccessibility` attribute through the reanimated mock, which no longer
  exists. They now pin the exact `importantForAccessibility` the screen passes (props captured by
  the file's local reanimated double, plus a second capture for the collapsed bar's
  `Animated.View`) rather than an `aria-hidden` read-back, which ORs the pair and let review
  mutants through (the Android lever moved onto `accessibilityElementsHidden`; the lever dropped
  only while the collapsed bar is not visible). Those mutants turn the file red again.
  `HomeScreen.render-item-stability.test.tsx` reads the same attribute through its own double
  and still passes; left alone.
- Review: `code-reviewer` + `mobile-reviewer`, no blocking findings. Fixed inline: the HomeScreen
  repair above (both reviewers), an overbroad "last two families" closure claim in the solution
  doc, and one inaccurate test comment. Deliberately not fixed (outside the Scope Contract, no
  test affected): `client/components/__tests__/ConfirmationModal.test.tsx` lines 195-221 still
  says the FlatList/SectionList/Animated.View sites are "NOT observable" because of the two mock
  gaps this change closes; `client/screens/__tests__/ChatListScreen.test.tsx` lines 58-60 and
  `docs/solutions/conventions/refresh-control-onrefresh-unreachable-under-scrollview-mock-2026-09-25.md`
  list the FlatList mock's destructured props, which now also include the two hiding props.
