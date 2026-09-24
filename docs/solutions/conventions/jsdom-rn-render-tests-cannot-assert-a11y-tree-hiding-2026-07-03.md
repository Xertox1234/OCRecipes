---
title: jsdom RN render tests cannot assert a11y-tree hiding OR grouping — assert label absence/uniqueness and exact full-label composition instead
track: knowledge
category: conventions
module: client
tags: [testing, accessibility, jsdom, render-tests, mocks]
applies_to: [client/components/**/__tests__/*.test.tsx, client/screens/**/__tests__/*.test.tsx, test/mocks/react-native.ts, test/mocks/expo-vector-icons.ts, test/mocks/react-native-reanimated.ts]
created: '2026-07-03'
last_updated: '2026-09-24'
---

# jsdom RN render tests cannot assert a11y-tree hiding OR grouping — assert label absence/uniqueness and exact full-label composition instead

## Rule

In jsdom render tests, never write (or name) a test as verifying that `accessible={false}` removes an element from the accessibility tree, or that `accessible={true}` collapses a subtree into one VoiceOver/TalkBack-announced node — the harness cannot model either direction of this prop (the `accessible` attribute never appears in the rendered DOM for either boolean value). Instead:

1. Assert **label absence** (`queryByLabelText(...)` is null) to guard against a decorative child re-acquiring its own `accessibilityLabel` (the `accessible={false}`/hiding case).

1a. **Every absence assertion needs a paired presence assertion on the same selector.** A `queryByLabelText(x)`/`queryByTestId(x)` that returns `null` cannot distinguish "the guard works" from "that selector matches nothing in this component, ever" — a typo'd testID, a renamed label, or a `testID` that was never added all produce the identical pass. Pair it with a positive-case test that resolves the same selector to a real node. The presence test is what proves the selector is wired; the absence test is only meaningful once it is.
2. For a grouping wrapper (`accessible={true}`), assert the **exact composed `accessibilityLabel` string** — a single `getByLabelText`/`findByLabelText` match already proves uniqueness (it throws if the label resolves to more than one element). Optionally strengthen it by asserting the wrapper's icon/text children carry no independent `aria-label` of their own (e.g. `wrapper.querySelector("[aria-label]")` is `null`) — the closest verifiable proxy to "children don't have separate accessible identities." Neither check proves the real subtree-collapse the harness can't model; the composed-label content is the actual regression guard.
3. Assert composed `accessibilityLabel` strings with **exact full-string matches, one per input combination** — never a start-anchored regex, which silently stops pinning the tail's spacing/punctuation.
4. **Accessibility actions** (`accessibilityActions` and `onAccessibilityAction`) suffer the same mock limitation: `accessibilityActions` is an array that is not destructured by the mock, so it falls through the `...rest` spread onto the DOM element, producing a useless attribute like `accessibilityactions="[object Object]"` (with a React dev warning). `onAccessibilityAction` is a function prop matching the `/^on[A-Z]/` pattern; React treats it as an unrecognized DOM event handler and **drops it entirely**, logging `Unknown event handler property ... It will be ignored.` — it never reaches the DOM node, so there is no way to invoke it via `fireEvent` or any other jsdom-based trigger. Therefore, never assert the contents of the `accessibilityActions` array or attempt to invoke `onAccessibilityAction` from a jsdom test. Instead, rely on the same label-based assertions (absence, exact composition) and verify that the visible Pressable's `onPress`, label, and role still work via `fireEvent.click`.

5. Name the test for what it proves (e.g. "does not carry a redundant label", "exposes exactly one accessible node with the composed label"), and leave on-device VoiceOver/TalkBack verification to the emulator-logcat procedure.

## Why

`test/mocks/react-native.ts`'s `mockComponent` helper does not destructure `accessible`, so the prop spreads onto the DOM `div` as a raw attribute instead of translating to real react-native-web behavior — `aria-hidden="true"` for `accessible={false}` (the `Received \`false\` for a non-boolean attribute \`accessible\`` console warning is this harness gap surfacing), or a collapsed single accessible node for `accessible={true}`. `queryByLabelText` returning null therefore proves only that the label prop is gone — the same assertion passes whether or not `accessible={false}` exists. Both the code-reviewer and mobile-reviewer independently flagged an overclaiming test name for this in the CarouselRecipeCard remix-badge a11y fix review.

The `accessible={true}` side of the same gap surfaced a second time in the confirm-card safety-flag badge (`client/screens/ScanScreen.tsx`), mirroring the ProductChip precedent (commit `8892c990`): the badge sets `accessible={true}` so VoiceOver reads one composed label instead of drilling into its `Feather` icon + `ThemedText` children, but a regression that removed `accessible={true}` from the production `View` would not fail any jsdom assertion, because the mock never models the collapse either direction. The mitigating pattern is the same as the hiding case — assert what's verifiable (uniqueness of the composed-label match, absence of a nested independent label) and be explicit in the test's name/comment that this does not prove the real collapse mechanism.

An empirical debug test (rendering `<View accessible={true}>` and `<View accessible={false}>` side by side and inspecting `container.querySelector(...).getAttributeNames()`) confirmed that the `accessible` attribute **never appears** in the rendered DOM for either boolean value. React logs a dev warning (`'Received \`false\` for a non-boolean attribute \`accessible\`'`) for the `false` case only; the `true` case produces no attribute and no warning. Therefore, DOM-based inspection cannot verify the `accessible={true}` intent any more than it can verify `accessible={false}` hiding — both are invisible to jsdom.

The same mock gap applies to `accessibilityActions` and `onAccessibilityAction`. Empirically confirmed: when a react-native `Pressable` with `accessibilityActions={[{name:'toggleFavourite', label:'Add to favourites'}]}` and `onAccessibilityAction={fn}` is rendered in the jsdom harness, `accessibilityActions` — an array not destructured by `mockComponent` — falls through the `...rest` spread and is stringified to `[object Object]` by React, with a dev warning that the prop is unrecognized. `onAccessibilityAction`, being a function prop that matches the `/^on[A-Z]/` convention, is treated by React as an unrecognized DOM event handler and is silently dropped (with a separate dev warning). No attribute or event listener for it appears on the DOM element. Consequently, any test that tries to assert the presence of a specific action name or to fire an accessibility action event will either check a meaningless string or trigger nothing at all. The correct pattern (proven in `client/components/home/__tests__/CarouselRecipeCard.test.tsx` and `client/screens/__tests__/FavouriteRecipesScreen.test.tsx`) is to assert only what is provable: the composed `accessibilityLabel` is unchanged/correct, and the pre-existing visible Pressable's own `onPress`, `label`, and `role` still work via `fireEvent.click`. Any verification of custom accessibility actions must be done on-device via the emulator-logcat procedure.

The exact-match rule exists because a prefix regex like `/^Remixed recipe\. Pasta/` accepts a label whose tail has broken spacing, a dropped segment, or is deleted outright — a template-literal regression after the anchored prefix passes CI silently.

## Examples

- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` (`describe("CarouselRecipeCard empty recommendationReason")`) — the rule 1a pairing, caught empirically: `queryByTestId("carousel-card-reason")` being `null` passed **before** the `testID` existed, so only 1 of the 2 new tests went red on the first TDD run. The presence test (`getByTestId(...).textContent`) is what makes the absence test mean anything. The same block also covers both halves of the empty-value guard — the composed label and the visible caption.
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — exact full-label assertions across all 4 `isRemix` × `prepTimeMinutes` combinations, plus a label-absence guard whose comment states the harness limitation explicitly (the `accessible={false}`/hiding case). Also demonstrates the pattern for `accessibilityActions`/`onAccessibilityAction`: no assertions on the actions array or event, only label and `onPress` verification.
- `client/screens/__tests__/ScanScreen.test.tsx` (`describe("ScanScreen — confirm-card safety badge (returnAfterLog)")`, `"exposes exactly one accessible node with the composed title+detail label"`) — the `accessible={true}`/grouping case: a single `findByLabelText` match on the composed label plus `badge.querySelector("[aria-label]")` being `null`, with a comment stating the same limitation.
- `client/screens/__tests__/FavouriteRecipesScreen.test.tsx` — applies the same `accessible` and `accessibilityActions` avoidance pattern: asserts only the visible Pressable's label and click behavior, never the custom action.

`client/components/__tests__/AllergenBadge.test.tsx` and `client/components/__tests__/VerificationBadge.test.tsx` — tests for the `accessible={true}` grouping fix on allergen and verification badges. Both rely solely on exact composed `accessibilityLabel` strings; inline comments note that `accessible` is not DOM-observable in jsdom and that the on-device a11y-tree behavior is verified separately via emulator logcat.

## Exceptions

- A partial/regex match is fine for labels containing genuinely dynamic data the test does not control (timestamps, ids) — pin everything static around it.
- **Partially executed 2026-08-17 (SpeedDial VoiceOver fix):** the mocks now map the
  EXPLICIT platform-hiding pair — `accessibilityElementsHidden` /
  `importantForAccessibility="no-hide-descendants"` (either one) — to `aria-hidden` on the
  DOM node (`ariaHiddenProps` in `test/mocks/react-native.ts`; the reanimated mock at
  `test/mocks/react-native-reanimated.ts` has its own separate `mapA11yProps()` helper that
  does **not** destructure `accessibilityElementsHidden` or `importantForAccessibility`, so
  those hiding props remain unmapped in the Reanimated path — this is a known, still-open
  residual gap, and it is LIVE, not hypothetical: `client/screens/ProfileScreen.tsx`,
  `client/screens/HomeScreen.tsx`, `client/components/cookbook/CookbookCoverPlate.tsx`,
  `client/camera/components/ProductChip.tsx` (its root forwards `importantForAccessibility`,
  `"no-hide-descendants"` while the scan confirm card is up), and
  `client/components/home/CollapsibleSection.tsx` all set `"no-hide-descendants"` and/or `accessibilityElementsHidden` directly on
  `Animated.View`, so their hiding is not assertable in jsdom via this mechanism.
  `client/components/TextInput.tsx`'s `Animated.Text` is NOT an instance of this gap: it
  sets `importantForAccessibility="no"`, which `ariaHiddenProps` deliberately never maps —
  closing the reanimated gap will not make it render `aria-hidden`).
  `client/components/home/CollapsibleSection.tsx` differs from the other four sites in one
  way: an `aria-hidden` read-back on its clip container's `Animated.View` already passes
  today, but only because the component also writes a literal `aria-hidden={!isExpanded}`
  prop alongside `importantForAccessibility` — `mapA11yProps()` doesn't destructure
  `aria-hidden` either, so it spreads through the `...domSafe` passthrough unchanged, not via
  any translation this doc's `ariaHiddenProps` mechanism provides. A regression that dropped
  `importantForAccessibility` (Android's real hiding) while keeping the literal `aria-hidden`
  prop would keep such a test green. So hiding
  via THAT pair **is** now assertable on plain RN primitives: `*ByRole` queries exclude the
  hidden node (use a role **count**, not a
  name filter — a name the fix itself removed can never match and the assertion is vacuous;
  mutation-proven in review), and non-role elements assert via `testID` +
  `getAttribute("aria-hidden") === "true"`. Exemplar:
  `client/components/__tests__/SpeedDial.test.tsx` ("accessibility tree membership").
  Everything this doc says about **`accessible={true/false}`** (and
  `accessibilityActions`/`onAccessibilityAction`) is UNCHANGED — those props still
  pass through untranslated, and the label-absence/composed-label patterns remain the
  only honest assertions for them.
- **Partially executed 2026-09-23 (Vector‑icon mock drops accessibility‑hiding props):**
  `test/mocks/expo-vector-icons.ts` previously spread `importantForAccessibility` /
  `accessibilityElementsHidden` raw onto the icon `<span>` instead of translating them via
  `ariaHiddenProps`, so icon hiding was untestable and produced a React unknown‑prop warning.
  Fixed by exporting `ariaHiddenProps` from `test/mocks/react-native.ts` (it was module‑private)
  and reusing it in `expo-vector-icons.ts`, following the exact reuse pattern
  `test/mocks/gorhom-bottom-sheet.ts` already used for `ariaModalProps`. Now, any icon that
  sets either hiding prop gets `aria-hidden="true"` on its DOM `<span>`, making icon hiding
  assertable via `container.querySelector('[data-icon="check-circle"]').getAttribute("aria-hidden") === "true"`.
  Exemplar: `client/components/__tests__/Toast.test.tsx` ("hides the status icon from the
  accessibility tree"). The Exceptions entry for `ariaHiddenProps` (2026-08-17) continues to
  govern all other RN primitives; this entry extends the same mechanism to vector icons.
  The `accessible={true/false}` and `accessibilityActions`/`onAccessibilityAction` rules
  remain unchanged.
  **Scope limit — an `aria-hidden` assertion proves "at least one hiding prop is set", not
  "the platform that needs it is covered".** `ariaHiddenProps` ORs the two props, so a
  regression that swaps the only prop doing real work (e.g. Toast's
  `importantForAccessibility="no-hide-descendants"`, its sole TalkBack hiding — iOS hiding
  comes from the parent `accessible` collapse) for `accessibilityElementsHidden` keeps the
  test green while Android regresses. Both props collapse to the same attribute, so no jsdom
  render test can tell them apart — the OR is intentional and pinned by
  `client/components/__tests__/Card.a11y.test.tsx`'s single-prop cases. When one platform's
  hiding hangs on one specific prop, say so in the test comment and leave that platform to
  on-device verification; never cite the `aria-hidden` read-back as proof of it.
- **Partially executed 2026-09-20 (BottomSheetModal background-trap fix):** the
  mocks now map `accessibilityViewIsModal` to `aria-modal="true"` on the DOM
  node (`ariaModalProps` in `test/mocks/react-native.ts`, applied both to
  plain RN primitives via `mockComponent` and, separately, to
  `BottomSheetView`/`BottomSheetScrollView` in
  `test/mocks/gorhom-bottom-sheet.ts`). So the sheet-content focus-trap prop
  **is** now assertable: `element.closest('[aria-modal="true"]')` resolves to
  the flagged ancestor (or `null` if absent/`false` — `ariaModalProps` omits
  the attribute entirely unless the value is exactly `true`). Exemplars:
  `client/components/meal-plan/__tests__/{AddItemMenuSheet,SimpleEntrySheet,QuickAddSheet}.test.tsx`
  — the `QuickAddSheet` case additionally asserts multiple children
  `.closest()` to the **same** node (ancestor-identity equality, not just
  presence), guarding against a regression that flags only one sibling (see
  `docs/solutions/logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md`
  — the prop only suppresses EARLIER siblings on iOS, so a partial flag is a
  real, distinct failure mode from simple absence). Everything else this doc
  says is unchanged.

## Related Files

- `test/mocks/react-native.ts` — `mockComponent` spreads `accessible`, `accessibilityActions`, and `onAccessibilityAction` through untranslated (the harness gap); `ariaModalProps` maps `accessibilityViewIsModal` → `aria-modal` (2026-09-20); `ariaHiddenProps` maps `accessibilityElementsHidden`/`importantForAccessibility` → `aria-hidden` (2026-08-17), now exported for reuse
- `test/mocks/gorhom-bottom-sheet.ts` — `BottomSheetView`/`BottomSheetScrollView` reuse `ariaModalProps` for parity with the shared `mockComponent` path (2026-09-20)
- `test/mocks/expo-vector-icons.ts` — icon mock now reuses `ariaHiddenProps` from `react-native.ts` (2026-09-23), making icon hiding assertable
- `test/mocks/react-native-reanimated.ts` — `mapA11yProps()` helper (around line 120) does **not** handle `accessibilityElementsHidden` or `importantForAccessibility`; these props remain unmapped for `Animated.View`/`Animated.Text`. Known open residual gap (2026-09-23).
- `client/camera/components/ProductChip.tsx` — root `Animated.View` forwards `importantForAccessibility` (set via `getScanOverlayA11y` in `client/screens/ScanScreenConfirmOverlay-utils.ts`); an instance of the reanimated gap above, so an `aria-hidden` hiding test against its root is meaningless until `mapA11yProps()` is fixed
- `client/components/home/CollapsibleSection.tsx` — clip-container `Animated.View` sets both `importantForAccessibility` and a literal `aria-hidden={!isExpanded}`; another instance of the reanimated gap, but the literal `aria-hidden` prop passes through `mapA11yProps()`'s `...domSafe` spread untranslated, so an `aria-hidden` read-back against it passes today for the wrong reason — it proves nothing about `importantForAccessibility`/Android hiding
- `client/components/meal-plan/AddItemMenuSheet.tsx`, `SimpleEntrySheet.tsx`, `QuickAddSheet.tsx` — the `accessibilityViewIsModal` fix under test (2026-09-20); `QuickAddSheet.tsx` is also the exemplar for converting a Fragment-rooted sheet to a single content-root `View` when no existing root exists
- `client/components/__tests__/Toast.test.tsx` — exemplar test for icon hiding assertion using `container.querySelector('[data-icon="check-circle"]').getAttribute("aria-hidden") === "true"` (2026-09-23)
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — the exemplar test file for the hiding case and the accessibilityActions avoidance pattern
- `client/components/home/CarouselRecipeCard.tsx` — the fix under test (label prefix + `accessible={false}` badge)
- `client/components/__tests__/AllergenBadge.test.tsx` — test for `accessible={true}` grouping fix on AllergenBadge
- `client/components/__tests__/VerificationBadge.test.tsx` — test for `accessible={true}` grouping fix on VerificationBadge
- `client/screens/__tests__/ScanScreen.test.tsx` — the exemplar test file for the grouping case
- `client/screens/ScanScreen.tsx` — the `confirmSafetyFlag` badge (`accessible={true}`) under test
- `client/screens/__tests__/FavouriteRecipesScreen.test.tsx` — test file applying the same avoidance pattern for accessibilityActions
- `client/screens/FavouriteRecipesScreen.tsx` — production screen using `accessibilityActions`/`onAccessibilityAction` on a favourite‑heart button
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — uses the same `accessibilityActions`/`onAccessibilityAction` pattern; jsdom tests follow the label‑only assertion rule

## See Also

- [Decorative badge double-announcement on interactive cards](../logic-errors/decorative-badge-double-announcement-2026-05-13.md)
- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md)