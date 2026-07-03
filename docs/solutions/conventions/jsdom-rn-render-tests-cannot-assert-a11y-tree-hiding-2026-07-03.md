---
title: jsdom RN render tests cannot assert a11y-tree hiding — assert label absence and exact full-label composition instead
track: knowledge
category: conventions
module: client
tags: [testing, accessibility, jsdom, render-tests, mocks]
applies_to: [client/components/**/__tests__/*.test.tsx, test/mocks/react-native.ts]
created: '2026-07-03'
---

# jsdom RN render tests cannot assert a11y-tree hiding — assert label absence and exact full-label composition instead

## Rule

In jsdom render tests, never write (or name) a test as verifying that `accessible={false}` removes an element from the accessibility tree — the harness cannot model it. Instead:

1. Assert **label absence** (`queryByLabelText(...)` is null) to guard against a decorative child re-acquiring its own `accessibilityLabel`.
2. Assert composed `accessibilityLabel` strings with **exact full-string matches, one per input combination** — never a start-anchored regex, which silently stops pinning the tail's spacing/punctuation.
3. Name the test for what it proves (e.g. "does not carry a redundant label"), and leave on-device VoiceOver/TalkBack verification to the emulator-logcat procedure.

## Why

`test/mocks/react-native.ts`'s `mockComponent` helper does not destructure `accessible`, so the prop spreads onto the DOM `div` as a raw attribute instead of translating to `aria-hidden="true"` the way real react-native-web does (the `Received \`false\` for a non-boolean attribute \`accessible\`` console warning is this harness gap surfacing). `queryByLabelText` returning null therefore proves only that the label prop is gone — the same assertion passes whether or not `accessible={false}` exists. Both the code-reviewer and mobile-reviewer independently flagged an overclaiming test name for this in the CarouselRecipeCard remix-badge a11y fix review.

The exact-match rule exists because a prefix regex like `/^Remixed recipe\. Pasta/` accepts a label whose tail has broken spacing, a dropped segment, or is deleted outright — a template-literal regression after the anchored prefix passes CI silently.

## Examples

`client/components/home/__tests__/CarouselRecipeCard.test.tsx` — exact full-label assertions across all 4 `isRemix` × `prepTimeMinutes` combinations, plus a label-absence guard whose comment states the harness limitation explicitly.

## Exceptions

- A partial/regex match is fine for labels containing genuinely dynamic data the test does not control (timestamps, ids) — pin everything static around it.
- If a11y-tree-hiding assertions become a recurring need, the durable fix is teaching `mockComponent` to map `accessible === false` → `aria-hidden="true"`; until then the mock's pass-through is pre-existing, accepted behavior.

## Related Files

- `test/mocks/react-native.ts` — `mockComponent` spreads `accessible` through untranslated (the harness gap)
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — the exemplar test file
- `client/components/home/CarouselRecipeCard.tsx` — the fix under test (label prefix + `accessible={false}` badge)

## See Also

- [Decorative badge double-announcement on interactive cards](../logic-errors/decorative-badge-double-announcement-2026-05-13.md)
- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md)
