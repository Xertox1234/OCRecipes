---
title: "Reanimated and FlatList/SectionList test mocks don't translate accessibility-hiding props, so hiding on those components can't be tested"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
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

- [ ] `mapA11yProps()` routes the two hiding props through `ariaHiddenProps` (import it from
      `./react-native`, the reuse pattern `test/mocks/gorhom-bottom-sheet.ts` uses)
- [ ] The FlatList and SectionList mocks apply `ariaHiddenProps` to their root element
- [ ] One test per mock family shows the prop now yields `aria-hidden="true"` and fails if the
      mapping is removed
- [ ] Full client suite stays green; fix any test that relied on the old raw/dropped behaviour
- [ ] Update the solution doc: mark both gaps closed and remove the per-site lists

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
