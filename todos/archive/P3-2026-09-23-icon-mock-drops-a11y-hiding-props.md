---
title: "Vector-icon test mock drops accessibility-hiding props, so icon hiding can't be tested"
status: done
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

- [x] The icon mock maps `importantForAccessibility="no-hide-descendants"` and `accessibilityElementsHidden` to `aria-hidden`, reusing (exporting if needed) the `ariaHiddenProps` helper from `test/mocks/react-native.ts` rather than copying it.
- [x] The React unknown-prop warning for these props no longer appears in `client/components/__tests__/Toast.test.tsx` output.
- [x] `Toast.test.tsx` asserts the icon is `aria-hidden`, and removing the prop from `client/components/Toast.tsx`'s Feather turns that test red.
- [x] The full client test suite still passes. Other icons that start rendering `aria-hidden` may change what `getByRole` queries see, so check for new failures.

## Implementation Notes

- Files: `test/mocks/expo-vector-icons.ts`, `test/mocks/react-native.ts` (export `ariaHiddenProps`), `client/components/__tests__/Toast.test.tsx`.
- `accessible={false}` has no ARIA equivalent here and should stay dropped, as in `mockComponent`.

## Updates

### 2026-09-23

- Filed from #1027 review.
- Implemented: exported `ariaHiddenProps` from `test/mocks/react-native.ts` and reused it in
  `test/mocks/expo-vector-icons.ts` to translate `accessibilityElementsHidden`/
  `importantForAccessibility="no-hide-descendants"` into `aria-hidden` on the icon mock's span.
  Added a `Toast.test.tsx` assertion (`hides the status icon from the accessibility tree`),
  selected via `container.querySelector('[data-icon="check-circle"]')` since `Toast.tsx`'s
  Feather has no `testID`. Verified TDD-red before the fix and mutation-red after temporarily
  removing the prop from `Toast.tsx` (then restored — `Toast.tsx` itself is unmodified). Full
  client suite (284 files / 3019 tests) and full repo suite (541 files / 8601 tests, with
  `.env` present) pass; `code-reviewer` and `mobile-reviewer` both returned no findings.

### 2026-09-24

- Post-review follow-up commits on PR #1040 (after the "no findings" pass above) corrected
  three things in `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`:
  the `ariaHiddenProps` docblock's OR/scope-limit claim, the incorrect inclusion of
  `client/components/TextInput.tsx` in the reanimated-gap enumeration (its `Animated.Text`
  sets `importantForAccessibility="no"`, which `ariaHiddenProps` never maps, so it isn't an
  instance of the gap), and the addition of `client/camera/components/ProductChip.tsx` as a
  live gap instance.
- A separate docs-only follow-up PR adds `client/components/home/CollapsibleSection.tsx` as a
  further live gap instance (with a caveat: its `aria-hidden` read-back already passes today,
  but only via a literal `aria-hidden` prop passing through `mapA11yProps()` untranslated, not
  via the `importantForAccessibility` mapping this doc's mechanism provides) and adds
  `test/mocks/react-native-reanimated.ts` to the doc's `applies_to` frontmatter.
