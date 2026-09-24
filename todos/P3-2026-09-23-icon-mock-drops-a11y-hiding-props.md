---
title: "Vector-icon test mock drops accessibility-hiding props, so icon hiding can't be tested"
status: in-progress
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, testing]
github_issue:
---

# Vector-icon test mock drops accessibility-hiding props, so icon hiding can't be tested

## Summary

`test/mocks/expo-vector-icons.ts` spreads its props raw onto a `<span>`. It never translates `importantForAccessibility` or `accessibilityElementsHidden` to `aria-hidden` the way `mockComponent` in `test/mocks/react-native.ts` does, so no test can check that an icon is hidden from screen readers.

## Background

Raised by #1027's mobile review (non-blocking). #1027 added `importantForAccessibility="no-hide-descendants"` to the Toast's Feather icon so TalkBack doesn't announce it separately. The message text's hiding is pinned by a test, but the icon's is not: the mock renders the prop as an unrecognised DOM attribute, and React logs "React does not recognize the importantForAccessibility prop" on every Toast test. Deleting the prop from the icon would leave CI green.

## Acceptance Criteria

- [ ] The icon mock maps `importantForAccessibility="no-hide-descendants"` and `accessibilityElementsHidden` to `aria-hidden`, reusing (exporting if needed) the `ariaHiddenProps` helper from `test/mocks/react-native.ts` rather than copying it.
- [ ] The React unknown-prop warning for these props no longer appears in `client/components/__tests__/Toast.test.tsx` output.
- [ ] `Toast.test.tsx` asserts the icon is `aria-hidden`, and removing the prop from `client/components/Toast.tsx`'s Feather turns that test red.
- [ ] The full client test suite still passes. Other icons that start rendering `aria-hidden` may change what `getByRole` queries see, so check for new failures.

## Implementation Notes

- Files: `test/mocks/expo-vector-icons.ts`, `test/mocks/react-native.ts` (export `ariaHiddenProps`), `client/components/__tests__/Toast.test.tsx`.
- `accessible={false}` has no ARIA equivalent here and should stay dropped, as in `mockComponent`.

## Updates

### 2026-09-23

- Filed from #1027 review.
