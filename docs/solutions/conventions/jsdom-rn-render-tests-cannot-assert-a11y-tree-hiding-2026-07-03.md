---
title: jsdom RN render tests cannot assert a11y-tree hiding — assert label absence and exact full-label composition instead
track: knowledge
category: conventions
module: client
tags: [testing, accessibility, jsdom, render-tests, mocks]
applies_to: [client/components/**/__tests__/*.test.tsx, test/mocks/react-native.ts]
created: '2026-07-03'
last_updated: '2026-07-21'
---

# jsdom RN render tests cannot assert a11y-tree hiding — assert label absence and exact full-label composition instead

## Rule

In jsdom render tests, never write (or name) a test as verifying that `accessible={false}` removes an element from the accessibility tree — the harness cannot model it.  Likewise, never attempt to verify `accessible={true}` via DOM inspection (e.g. checking for an `accessible` attribute) — the attribute never appears in the rendered DOM for either boolean value. Instead:

1. Assert **label absence** (`queryByLabelText(...)` is null) to guard against a decorative child re-acquiring its own `accessibilityLabel`.
2. Assert composed `accessibilityLabel` strings with **exact full-string matches, one per input combination** — never a start-anchored regex, which silently stops pinning the tail's spacing/punctuation.
3. Name the test for what it proves (e.g. "does not carry a redundant label"), and leave on-device VoiceOver/TalkBack verification to the emulator-logcat procedure.
4. For `accessible={true}` grouping fixes, rely solely on exact composed `accessibilityLabel` strings (rule #2) — there is no DOM-observable proxy for the grouping/single-node behavior in either direction. Both `true` and `false` are unobservable in jsdom; the only regression check for a grouping fix is the label content itself.

## Why

`test/mocks/react-native.ts`'s `mockComponent` helper does not destructure `accessible`, so the prop spreads onto the DOM `div` as a raw attribute instead of translating to `aria-hidden="true"` the way real react-native-web does (the `Received \`false\` for a non-boolean attribute \`accessible\`` console warning is this harness gap surfacing). `queryByLabelText` returning null therefore proves only that the label prop is gone — the same assertion passes whether or not `accessible={false}` exists. Both the code-reviewer and mobile-reviewer independently flagged an overclaiming test name for this in the CarouselRecipeCard remix-badge a11y fix review.

An empirical debug test (rendering `<View accessible={true}>` and `<View accessible={false}>` side by side and inspecting `container.querySelector(...).getAttributeNames()`) confirmed that the `accessible` attribute **never appears** in the rendered DOM for either boolean value. React logs a dev warning (`'Received \`false\` for a non-boolean attribute \`accessible\`'`) for the `false` case only; the `true` case produces no attribute and no warning. Therefore, DOM-based inspection cannot verify the `accessible={true}` intent any more than it can verify `accessible={false}` hiding — both are invisible to jsdom.

The exact-match rule exists because a prefix regex like `/^Remixed recipe\. Pasta/` accepts a label whose tail has broken spacing, a dropped segment, or is deleted outright — a template-literal regression after the anchored prefix passes CI silently.

## Examples

`client/components/home/__tests__/CarouselRecipeCard.test.tsx` — exact full-label assertions across all 4 `isRemix` × `prepTimeMinutes` combinations, plus a label-absence guard whose comment states the harness limitation explicitly.

`client/components/__tests__/AllergenBadge.test.tsx` and `client/components/__tests__/VerificationBadge.test.tsx` — tests for the `accessible={true}` grouping fix on allergen and verification badges. Both rely solely on exact composed `accessibilityLabel` strings; inline comments note that `accessible` is not DOM-observable in jsdom and that the on-device a11y-tree behavior is verified separately via emulator logcat.

## Exceptions

- A partial/regex match is fine for labels containing genuinely dynamic data the test does not control (timestamps, ids) — pin everything static around it.
- If a11y-tree-hiding assertions become a recurring need, the durable fix is teaching `mockComponent` to map `accessible === false` → `aria-hidden="true"`; until then the mock's pass-through is pre-existing, accepted behavior.

## Related Files

- `test/mocks/react-native.ts` — `mockComponent` spreads `accessible` through untranslated (the harness gap)
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — the exemplar test file
- `client/components/home/CarouselRecipeCard.tsx` — the fix under test (label prefix + `accessible={false}` badge)
- `client/components/__tests__/AllergenBadge.test.tsx` — test for `accessible={true}` grouping fix on AllergenBadge
- `client/components/__tests__/VerificationBadge.test.tsx` — test for `accessible={true}` grouping fix on VerificationBadge

## See Also

- [Decorative badge double-announcement on interactive cards](../logic-errors/decorative-badge-double-announcement-2026-05-13.md)
- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md)