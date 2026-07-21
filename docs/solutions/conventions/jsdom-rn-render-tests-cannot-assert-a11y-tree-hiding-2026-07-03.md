---
title: jsdom RN render tests cannot assert a11y-tree hiding OR grouping — assert label absence/uniqueness and exact full-label composition instead
track: knowledge
category: conventions
module: client
tags: [testing, accessibility, jsdom, render-tests, mocks]
applies_to: [client/components/**/__tests__/*.test.tsx, client/screens/**/__tests__/*.test.tsx, test/mocks/react-native.ts]
created: '2026-07-03'
last_updated: '2026-07-21'
---

# jsdom RN render tests cannot assert a11y-tree hiding OR grouping — assert label absence/uniqueness and exact full-label composition instead

## Rule

In jsdom render tests, never write (or name) a test as verifying that `accessible={false}` removes an element from the accessibility tree, or that `accessible={true}` collapses a subtree into one VoiceOver/TalkBack-announced node — the harness cannot model either direction of this prop (the `accessible` attribute never appears in the rendered DOM for either boolean value). Instead:

1. Assert **label absence** (`queryByLabelText(...)` is null) to guard against a decorative child re-acquiring its own `accessibilityLabel` (the `accessible={false}`/hiding case).
2. For a grouping wrapper (`accessible={true}`), assert the **exact composed `accessibilityLabel` string** — a single `getByLabelText`/`findByLabelText` match already proves uniqueness (it throws if the label resolves to more than one element). Optionally strengthen it by asserting the wrapper's icon/text children carry no independent `aria-label` of their own (e.g. `wrapper.querySelector("[aria-label]")` is `null`) — the closest verifiable proxy to "children don't have separate accessible identities." Neither check proves the real subtree-collapse the harness can't model; the composed-label content is the actual regression guard.
3. Assert composed `accessibilityLabel` strings with **exact full-string matches, one per input combination** — never a start-anchored regex, which silently stops pinning the tail's spacing/punctuation.
4. Name the test for what it proves (e.g. "does not carry a redundant label", "exposes exactly one accessible node with the composed label"), and leave on-device VoiceOver/TalkBack verification to the emulator-logcat procedure.

## Why

`test/mocks/react-native.ts`'s `mockComponent` helper does not destructure `accessible`, so the prop spreads onto the DOM `div` as a raw attribute instead of translating to real react-native-web behavior — `aria-hidden="true"` for `accessible={false}` (the `Received \`false\` for a non-boolean attribute \`accessible\`` console warning is this harness gap surfacing), or a collapsed single accessible node for `accessible={true}`. `queryByLabelText` returning null therefore proves only that the label prop is gone — the same assertion passes whether or not `accessible={false}` exists. Both the code-reviewer and mobile-reviewer independently flagged an overclaiming test name for this in the CarouselRecipeCard remix-badge a11y fix review.

The `accessible={true}` side of the same gap surfaced a second time in the confirm-card safety-flag badge (`client/screens/ScanScreen.tsx`), mirroring the ProductChip precedent (commit `8892c990`): the badge sets `accessible={true}` so VoiceOver reads one composed label instead of drilling into its `Feather` icon + `ThemedText` children, but a regression that removed `accessible={true}` from the production `View` would not fail any jsdom assertion, because the mock never models the collapse either direction. The mitigating pattern is the same as the hiding case — assert what's verifiable (uniqueness of the composed-label match, absence of a nested independent label) and be explicit in the test's name/comment that this does not prove the real collapse mechanism.

An empirical debug test (rendering `<View accessible={true}>` and `<View accessible={false}>` side by side and inspecting `container.querySelector(...).getAttributeNames()`) confirmed that the `accessible` attribute **never appears** in the rendered DOM for either boolean value. React logs a dev warning (`'Received \`false\` for a non-boolean attribute \`accessible\`'`) for the `false` case only; the `true` case produces no attribute and no warning. Therefore, DOM-based inspection cannot verify the `accessible={true}` intent any more than it can verify `accessible={false}` hiding — both are invisible to jsdom.

The exact-match rule exists because a prefix regex like `/^Remixed recipe\. Pasta/` accepts a label whose tail has broken spacing, a dropped segment, or is deleted outright — a template-literal regression after the anchored prefix passes CI silently.

## Examples

- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — exact full-label assertions across all 4 `isRemix` × `prepTimeMinutes` combinations, plus a label-absence guard whose comment states the harness limitation explicitly (the `accessible={false}`/hiding case).
- `client/screens/__tests__/ScanScreen.test.tsx` (`describe("ScanScreen — confirm-card safety badge (returnAfterLog)")`, `"exposes exactly one accessible node with the composed title+detail label"`) — the `accessible={true}`/grouping case: a single `findByLabelText` match on the composed label plus `badge.querySelector("[aria-label]")` being `null`, with a comment stating the same limitation.

`client/components/__tests__/AllergenBadge.test.tsx` and `client/components/__tests__/VerificationBadge.test.tsx` — tests for the `accessible={true}` grouping fix on allergen and verification badges. Both rely solely on exact composed `accessibilityLabel` strings; inline comments note that `accessible` is not DOM-observable in jsdom and that the on-device a11y-tree behavior is verified separately via emulator logcat.

## Exceptions

- A partial/regex match is fine for labels containing genuinely dynamic data the test does not control (timestamps, ids) — pin everything static around it.
- If a11y-tree-hiding or -grouping assertions become a recurring need, the durable fix is teaching `mockComponent` to map `accessible === false` → `aria-hidden="true"` and `accessible === true` (with descendant labels) → collapse to a single labelled node; until then the mock's pass-through is pre-existing, accepted behavior.

## Related Files

- `test/mocks/react-native.ts` — `mockComponent` spreads `accessible` through untranslated in both directions (the harness gap)
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — the exemplar test file for the hiding case
- `client/components/home/CarouselRecipeCard.tsx` — the fix under test (label prefix + `accessible={false}` badge)
- `client/components/__tests__/AllergenBadge.test.tsx` — test for `accessible={true}` grouping fix on AllergenBadge
- `client/components/__tests__/VerificationBadge.test.tsx` — test for `accessible={true}` grouping fix on VerificationBadge
- `client/screens/__tests__/ScanScreen.test.tsx` — the exemplar test file for the grouping case
- `client/screens/ScanScreen.tsx` — the `confirmSafetyFlag` badge (`accessible={true}`) under test
- `client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx` — the earlier ProductChip precedent for the same grouping pattern (commit `8892c990`)

## See Also

- [Decorative badge double-announcement on interactive cards](../logic-errors/decorative-badge-double-announcement-2026-05-13.md)
- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md)