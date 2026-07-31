---
title: Assert the rendered source, not the labelled node, when a component labels its fallback identically
track: knowledge
category: conventions
module: client
tags: [testing, vitest, jsdom, react-native, accessibility, fallback-image, assertions]
applies_to: [client/**/__tests__/*.test.tsx]
created: '2026-07-30'
---

# Assert the rendered source, not the labelled node, when a component labels its fallback identically

## Rule

When the component under test has a **graceful-degradation branch that carries
the same accessibility label as its success branch**, `getByLabelText(...)` is
not a valid assertion that the success branch rendered. Assert something only
the success branch can produce — the `src`, the `href`, the text of the real
value.

`FallbackImage` is the repo's canonical example: it deliberately puts the
caller's `accessibilityLabel` on its grey placeholder `View` *and* on a loaded
`Image`, so a screen-reader user hears the right thing either way. That is
correct product behaviour and it makes the label useless as a test
discriminator.

## Smell patterns

- A test whose only assertion is `getByLabelText(...)`, `getByTestId(...)`, or
  `toBeTruthy()` against a component that has a fallback, placeholder,
  skeleton, or error branch.
- A test that would still pass if the data it is nominally about were `null`.
- The assertion targets *presence* rather than *value*.
- An accessibility label placed on a wrapper that survives both branches — the
  wrapper is found whichever branch rendered.

## Why

The regression this hides is invisible and user-facing: point `source` at the
wrong field, `hasValidUri` returns false, the user gets a grey box where their
photo should be, and every test stays green. Nothing fails, so nothing gets
investigated.

Verify by sabotage. Break the thing the test is nominally about, re-run, and
confirm it goes red. If it stays green, the test asserts nothing:

```
force `source={{ uri: undefined }}`  →  2 failures under the strong assertion
                                         0 failures under `getByLabelText` alone
```

Thirty seconds, and it is the only way to distinguish "my test passes" from
"my test would notice."

## Examples

```typescript
// GOOD — only the loaded branch emits an <img> at all, and the RN mock sets
// `src` from `source.uri`, so both "did a real photo render" and "was it the
// RIGHT photo" are checkable.
function expectPhotoWithSource(tile: HTMLElement, expectedUri: string) {
  const img = tile.querySelector("img");
  expect(img).toBeTruthy();
  expect(img?.getAttribute("src")).toBe(expectedUri);
}

expectPhotoWithSource(getByLabelText(LABEL_A11Y), "file://panel.jpg");
```

```typescript
// BAD — passes identically whether the user's photo rendered or a grey
// placeholder icon did.
expect(getByLabelText("Nutrition label you photographed")).toBeTruthy();
```

The same trap applies to any two-string comparison where both sides are
hand-written. Asserting that a group's label contains a caption proves nothing
if the caption and the label are two separate literals in the test file that
happen to overlap — read both off the DOM so the assertion tracks the
component:

```typescript
// GOOD — fails the moment the caption and the group label drift apart.
function expectCaptionSubsumedByGroupLabel(tile: HTMLElement) {
  const caption = tile.textContent ?? "";
  expect(caption.length).toBeGreaterThan(0); // `toContain("")` is always true
  expect(tile.getAttribute("aria-label")).toContain(caption);
}
```

```typescript
// BAD — compares two literals defined a few lines apart in this same file.
expect(getByLabelText(LABEL_A11Y).textContent).toContain("Nutrition label");
```

## Exceptions

A presence-only assertion is fine when presence genuinely *is* the contract —
a negative control ("no photo section renders for a barcode-only scan"), or a
component with no degraded branch to be confused with. Note that a negative
control legitimately passes before the feature exists; that is the point of
one, and it does not make it a weak test.

## Related Files

- `client/components/FallbackImage.tsx` — labels the fallback `View` and the
  loaded `Image` identically, by design
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` —
  `expectPhotoWithSource` and `expectCaptionSubsumedByGroupLabel`
- `test/mocks/react-native.ts` — the `Image` mock that makes `src` and
  `aria-label` observable

## See Also

- [FallbackImage for remote image loading with themed placeholder](../design-patterns/fallback-image-remote-image-loading-2026-05-13.md) — the component whose dual-branch labelling causes this
- [A hand-written mock in the shared RN mock file drops a prop the generic helper translates](../logic-errors/touchableopacity-mock-missing-onpress-wiring-2026-07-14.md) — the sibling harness gap that made image labels unassertable at all
- [A screen that restates its own route params SHADOWS the canonical ParamList](../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md) — the bug this weak assertion was written for
