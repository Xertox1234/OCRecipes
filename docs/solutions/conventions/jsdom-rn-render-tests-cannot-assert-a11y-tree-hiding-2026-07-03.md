---
title: jsdom RN render tests cannot assert a11y-tree hiding OR grouping — assert label absence/uniqueness and exact full-label composition instead
track: knowledge
category: conventions
module: client
tags: [testing, accessibility, jsdom, render-tests, mocks]
applies_to: [client/components/**/__tests__/*.test.tsx, client/screens/**/__tests__/*.test.tsx, test/mocks/react-native.ts, test/mocks/expo-vector-icons.ts, test/mocks/react-native-reanimated.ts]
created: '2026-07-03'
last_updated: '2026-10-02'
---

# jsdom RN render tests cannot assert a11y-tree hiding OR grouping — assert label absence/uniqueness and exact full-label composition instead

## Rule

In jsdom render tests, never write (or name) a test as verifying that `accessible={false}` removes an element from the accessibility tree, or that `accessible={true}` collapses a subtree into one VoiceOver/TalkBack-announced node — the harness cannot model either direction of this prop (the `accessible` attribute never appears in the rendered DOM for either boolean value). Instead:

1. Assert **label absence** (`queryByLabelText(...)` is null) to guard against a decorative child re-acquiring its own `accessibilityLabel` (the `accessible={false}`/hiding case).

1a. **Every absence assertion needs a paired presence assertion on the same selector.** A `queryByLabelText(x)`/`queryByTestId(x)` that returns `null` cannot distinguish "the guard works" from "that selector matches nothing in this component, ever" — a typo'd testID, a renamed label, or a `testID` that was never added all produce the identical pass. Pair it with a positive-case test that resolves the same selector to a real node. The presence test is what proves the selector is wired; the absence test is only meaningful once it is.
2. For a grouping wrapper (`accessible={true}`), assert the **exact composed `accessibilityLabel` string** — a single `getByLabelText`/`findByLabelText` match already proves uniqueness (it throws if the label resolves to more than one element). Optionally strengthen it by asserting the wrapper's icon/text children carry no independent `aria-label` of their own (e.g. `wrapper.querySelector("[aria-label]")` is `null`) — the closest verifiable proxy to "children don't have separate accessible identities." Neither check proves the real subtree-collapse the harness can't model; the composed-label content is the actual regression guard.
3. Assert composed `accessibilityLabel` strings with **exact full-string matches, one per input combination** — never a start-anchored regex, which silently stops pinning the tail's spacing/punctuation.
4. **Accessibility actions** (`accessibilityActions` and `onAccessibilityAction`) suffer the same mock limitation via the **DOM/fireEvent channel**: `accessibilityActions` is an array that is not destructured by the mock, so it falls through the `...rest` spread onto the DOM element, producing a useless attribute like `accessibilityactions="[object Object]"` (with a React dev warning). `onAccessibilityAction` is a function prop matching the `/^on[A-Z]/` pattern; React treats it as an unrecognized DOM event handler and **drops it entirely**, logging `Unknown event handler property ... It will be ignored.` — it never reaches the DOM node, so there is no way to invoke it via `fireEvent` or any other jsdom-based trigger. Therefore, never assert the contents of the `accessibilityActions` array or attempt to invoke `onAccessibilityAction` from a jsdom test **by querying the DOM or firing a DOM event**. Instead, rely on the same label-based assertions (absence, exact composition) and verify that the visible Pressable's `onPress`, label, and role still work via `fireEvent.click` — **unless** the test needs to assert the array's contents or invoke the handler directly, in which case the mock-boundary prop-capture technique in Exceptions (2026-09-25) below is the sound alternative; it observes the real prop values before the DOM/event mangling happens, rather than trying to see them after.

5. Name the test for what it proves (e.g. "does not carry a redundant label", "exposes exactly one accessible node with the composed label"), and leave on-device VoiceOver/TalkBack verification to the emulator-logcat procedure.

## Why

`test/mocks/react-native.ts`'s `mockComponent` helper does not destructure `accessible`, so the prop spreads onto the DOM `div` as a raw attribute instead of translating to real react-native-web behavior — `aria-hidden="true"` for `accessible={false}` (the `Received \`false\` for a non-boolean attribute \`accessible\`` console warning is this harness gap surfacing), or a collapsed single accessible node for `accessible={true}`. `queryByLabelText` returning null therefore proves only that the label prop is gone — the same assertion passes whether or not `accessible={false}` exists. Both the code-reviewer and mobile-reviewer independently flagged an overclaiming test name for this in the CarouselRecipeCard remix-badge a11y fix review.

The `accessible={true}` side of the same gap surfaced a second time in the confirm-card safety-flag badge (`client/screens/ScanScreen.tsx`), mirroring the ProductChip precedent (commit `8892c990`): the badge sets `accessible={true}` so VoiceOver reads one composed label instead of drilling into its `Feather` icon + `ThemedText` children, but a regression that removed `accessible={true}` from the production `View` would not fail any jsdom assertion, because the mock never models the collapse either direction. The mitigating pattern is the same as the hiding case — assert what's verifiable (uniqueness of the composed-label match, absence of a nested independent label) and be explicit in the test's name/comment that this does not prove the real collapse mechanism.

An empirical debug test (rendering `<View accessible={true}>` and `<View accessible={false}>` side by side and inspecting `container.querySelector(...).getAttributeNames()`) confirmed that the `accessible` attribute **never appears** in the rendered DOM for either boolean value. React logs a dev warning (`'Received \`false\` for a non-boolean attribute \`accessible\`'`) for the `false` case only; the `true` case produces no attribute and no warning. Therefore, DOM-based inspection cannot verify the `accessible={true}` intent any more than it can verify `accessible={false}` hiding — both are invisible to jsdom.

The same mock gap applies to `accessibilityActions` and `onAccessibilityAction`. Empirically confirmed: when a react-native `Pressable` with `accessibilityActions={[{name:'toggleFavourite', label:'Add to favourites'}]}` and `onAccessibilityAction={fn}` is rendered in the jsdom harness, `accessibilityActions` — an array not destructured by `mockComponent` — falls through the `...rest` spread and is stringified to `[object Object]` by React, with a dev warning that the prop is unrecognized. `onAccessibilityAction`, being a function prop that matches the `/^on[A-Z]/` convention, is treated by React as an unrecognized DOM event handler and is silently dropped (with a separate dev warning). No attribute or event listener for it appears on the DOM element. Consequently, any test that tries to assert the presence of a specific action name or to fire an accessibility action event will either check a meaningless string or trigger nothing at all. The correct pattern (proven in `client/components/home/__tests__/CarouselRecipeCard.test.tsx` and `client/screens/__tests__/FavouriteRecipesScreen.test.tsx`) is to assert only what is provable: the composed `accessibilityLabel` is unchanged/correct, and the pre-existing visible Pressable's own `onPress`, `label`, and `role` still work via `fireEvent.click`. Any verification of custom accessibility actions must be done on-device via the emulator-logcat procedure.

The exact-match rule exists because a prefix regex like `/^Remixed recipe\. Pasta/` accepts a label whose tail has broken spacing, a dropped segment, or is deleted outright — a template-literal regression after the anchored prefix passes CI silently.

## Examples

- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` (`describe("CarouselRecipeCard empty recommendationReason")`) — the rule 1a pairing, caught empirically: `queryByTestId("carousel-card-reason")` being `null` passed **before** the `testID` existed, so only 1 of the 2 new tests went red on the first TDD run. The presence test (`getByTestId(...).textContent`) is what makes the absence test mean anything. The same block also covers both halves of the empty-value guard — the composed label and the visible caption.
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — exact full-label assertions across all 4 `isRemix` × `prepTimeMinutes` combinations, plus a label-absence guard whose comment states the harness limitation explicitly (the `accessible={false}`/hiding case).
- `client/screens/__tests__/ScanScreen.test.tsx` (`describe("ScanScreen — confirm-card safety badge (returnAfterLog)")`, `"exposes exactly one accessible node with the composed title+detail label"`) — the `accessible={true}`/grouping case: a single `findByLabelText` match on the composed label plus `badge.querySelector("[aria-label]")` being `null`, with a comment stating the same limitation.
- `client/screens/__tests__/FavouriteRecipesScreen.test.tsx` — applies the DOM/fireEvent-channel `accessible`/`accessibilityActions` avoidance pattern (no mock-boundary capture in this file): asserts only the visible Pressable's label and click behavior, never the custom action.
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` (`describe("CarouselRecipeCard dismiss accessibility action")`) and `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` (`describe("MealSlotItem accessibility actions")`, `describe("MealSlotSection suggest accessibility action")`) — the mock-boundary prop-capture exception (2026-09-25 below): these DO assert the `accessibilityActions` array's exact contents and DO invoke `onAccessibilityAction` directly, because they capture the raw props object before the DOM/event mangling this rule describes, not through it.

`client/components/__tests__/AllergenBadge.test.tsx` and `client/components/__tests__/VerificationBadge.test.tsx` — tests for the `accessible={true}` grouping fix on allergen and verification badges. Both rely solely on exact composed `accessibilityLabel` strings; inline comments note that `accessible` is not DOM-observable in jsdom and that the on-device a11y-tree behavior is verified separately via emulator logcat.

## Exceptions

- A partial/regex match is fine for labels containing genuinely dynamic data the test does not control (timestamps, ids) — pin everything static around it.
- **Partially executed 2026-08-17 (SpeedDial VoiceOver fix):** the mocks now map the
  EXPLICIT platform-hiding pair — `accessibilityElementsHidden` /
  `importantForAccessibility="no-hide-descendants"` (either one) — to `aria-hidden` on the
  DOM node (`ariaHiddenProps` in `test/mocks/react-native.ts`). Two further families were
  left unmapped at the time — the reanimated mock's `mapA11yProps()` and the
  FlatList/SectionList mocks; the 2026-10-02 entry below closes both. So hiding
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
- **Partially executed 2026-09-25 (meal-plan/CarouselRecipeCard accessibility-actions fix):**
  rule 4's "never assert the contents of `accessibilityActions` or invoke
  `onAccessibilityAction`" holds **unchanged for the DOM/fireEvent channel** — that
  path still can't observe either prop, for the exact reasons rule 4 describes. But a
  distinct technique sidesteps the DOM boundary entirely instead of trying to see
  through it: a local `vi.mock("react-native", ...)` override wraps the shared
  mock's `Pressable` in a capturing component that records each render's raw
  `props` object **before** it reaches `mockComponent`'s `...rest` spread onto the
  DOM (the exact point where the array gets stringified and the handler gets
  dropped by React's unknown-DOM-event-handler rule). A plain JS object passed to
  a React component function is never mangled the way a DOM attribute or event
  listener is, so the captured `props.accessibilityActions` is the real array and
  `props.onAccessibilityAction` is the real function reference the production
  component built via its own `useMemo`/`useCallback` — both are then asserted or
  invoked directly, proving the actual production wiring rather than a
  re-implemented stand-in. See `client/components/home/__tests__/CarouselRecipeCard.test.tsx`
  (`describe("CarouselRecipeCard dismiss accessibility action")`) and
  `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`
  (`describe("MealSlotItem accessibility actions")`,
  `describe("MealSlotSection suggest accessibility action")`) for the worked
  pattern. Find the Pressable under test by a **discriminating prop** (e.g.
  `typeof p.onAccessibilityAction === "function"`), not by index or render
  order — sibling Pressables in the same component (a visible Confirm/Remove
  button, a Suggest chip) render into the same capture array, and only the
  accessibility-actions-bearing one carries that prop. This is also the
  legitimate reason category the `inline-vi-mock-globally-aliased-modules`
  doc's numbered list was missing — see its item 5.
- **Executed 2026-10-02 (reanimated + list mocks drop the hiding pair):** closes the two
  families the 2026-08-17 entry above left open. They now translate the pair through the same
  `ariaHiddenProps` helper (imported from `./react-native`, the reuse pattern
  `test/mocks/gorhom-bottom-sheet.ts` and `test/mocks/expo-vector-icons.ts` already follow).
  `mapA11yProps()` in `test/mocks/react-native-reanimated.ts` now consumes both props for
  `Animated.View` / `Animated.Text`; before, `importantForAccessibility` reached the DOM node
  as a raw lowercased attribute plus a React unknown-prop warning, and
  `accessibilityElementsHidden` was dropped with a warning. `createFlatListMock` (so `FlatList`
  and `BottomSheetFlatList`) and the hand-written `SectionList` in `test/mocks/react-native.ts`
  now apply it to their root element; before, they destructured a fixed prop list and dropped
  both props silently. They still do NOT spread `...rest` — that would hand `refreshControl`,
  `contentContainerStyle` and every `on*` handler to the DOM element. Hiding on those
  components is now assertable like on plain RN primitives (a role count, or
  `getAttribute("aria-hidden")`), including from a screen test that renders a list while
  `useConfirmationModal()`'s `behindContentA11yProps` is live. Four things to know:
  - A raw `importantforaccessibility` read-back on a reanimated element no longer works — the
    attribute is consumed. Read `aria-hidden` for tree membership, or capture the props the
    screen passes at the mock boundary when the exact per-platform value matters (below).
  - `importantForAccessibility="no"` is still deliberately never mapped: it excludes only the
    node itself, not its subtree (`client/components/TextInput.tsx`'s `Animated.Text` sets
    it), so such an element renders no `aria-hidden`.
  - A literal `aria-hidden` next to the pair (the clip container in
    `client/components/home/CollapsibleSection.tsx` sets one beside
    `importantForAccessibility`, in lockstep): the translated value is spread after the
    literal one, so "hidden" from either side wins and a literal that agrees simply passes
    through. In production, React Native 0.81's `View.js` derives
    `importantForAccessibility="no-hide-descendants"` from `aria-hidden === true`.
  - Other mock exports still pass the pair through untranslated: `Image`, `TextInput`,
    `Modal`, `ActivityIndicator`, `TouchableOpacity` and `Switch` in
    `test/mocks/react-native.ts`, and the `expo-image`, `expo-blur` and
    `expo-linear-gradient` mocks (read from the mock sources on 2026-10-02; the svg, screens
    and gesture-handler mocks were not checked). Route the pair through `ariaHiddenProps` the
    way the mocks above do before asserting `aria-hidden` on one of them.

  The OR scope limit in the 2026-09-23 entry above applies unchanged to every family here: a
  passing `aria-hidden` read-back proves AT LEAST ONE hiding prop is set, not which platform
  is covered — a regression that moves the Android lever onto the iOS-only
  `accessibilityElementsHidden` keeps `aria-hidden` set. When the exact value matters, use the
  mock-boundary prop capture from the 2026-09-25 entry:
  `client/screens/__tests__/HomeScreen.test.tsx`'s TalkBack background-trap tests pin
  `importantForAccessibility` exactly that way (its local reanimated double records the props
  passed to `Animated.ScrollView` and to the collapsed bar's `Animated.View`). The contract
  tests — one block per family, with single-prop rows that were mutation-checked — are
  `test/mocks/__tests__/a11y-hiding-props.test.tsx`.

## Related Files

- `test/mocks/react-native.ts` — `mockComponent` spreads `accessible`, `accessibilityActions`, and `onAccessibilityAction` through untranslated (the harness gap); `ariaModalProps` maps `accessibilityViewIsModal` → `aria-modal` (2026-09-20); `ariaHiddenProps` maps `accessibilityElementsHidden`/`importantForAccessibility` → `aria-hidden` (2026-08-17), now exported for reuse; `createFlatListMock` (`FlatList`, `BottomSheetFlatList`) and the hand-written `SectionList` apply it to their root element (2026-10-02)
- `test/mocks/gorhom-bottom-sheet.ts` — `BottomSheetView`/`BottomSheetScrollView` reuse `ariaModalProps` for parity with the shared `mockComponent` path (2026-09-20)
- `test/mocks/expo-vector-icons.ts` — icon mock now reuses `ariaHiddenProps` from `react-native.ts` (2026-09-23), making icon hiding assertable
- `test/mocks/react-native-reanimated.ts` — `mapA11yProps()` routes `accessibilityElementsHidden`/`importantForAccessibility` through `ariaHiddenProps` (imported from `test/mocks/react-native.ts`) for `Animated.View`/`Animated.Text` (2026-10-02)
- `test/mocks/__tests__/a11y-hiding-props.test.tsx` — contract test for the reanimated and list families: hidden, not-hidden and single-prop rows, no raw attribute leak, a literal `aria-hidden` beside the pair
- `client/screens/__tests__/HomeScreen.test.tsx` — the Android TalkBack background-trap tests pin the exact `importantForAccessibility` the screen passes (props captured by the file's local reanimated double), because an `aria-hidden` read-back ORs the pair and cannot isolate the Android lever; the worked example of the mock-boundary capture applied to the reanimated mock
- Note on this doc's `applies_to`: the three test-mock entries (`test/mocks/react-native.ts`, `test/mocks/expo-vector-icons.ts`, `test/mocks/react-native-reanimated.ts`) are currently INERT — `scripts/lib/path-domains.ts` routes `test/mocks/` to no domain (running it via npx tsx on `test/mocks/react-native-reanimated.ts` prints nothing), and retrieval selects by routed domain before `applies_to` is consulted. (`inject-patterns.sh` does fall back to the `typescript` domain for an unrouted `.ts` file, but this doc has no `typescript` tag, so that fallback doesn't reach it either.) They take effect only if a `test/mocks/` routing rule is added or this doc gains a `typescript` tag; until then this doc is injected only on edits matched by the two client `__tests__` globs in `applies_to`
- `client/components/meal-plan/AddItemMenuSheet.tsx`, `SimpleEntrySheet.tsx`, `QuickAddSheet.tsx` — the `accessibilityViewIsModal` fix under test (2026-09-20); `QuickAddSheet.tsx` is also the exemplar for converting a Fragment-rooted sheet to a single content-root `View` when no existing root exists
- `client/components/__tests__/Toast.test.tsx` — exemplar test for icon hiding assertion using `container.querySelector('[data-icon="check-circle"]').getAttribute("aria-hidden") === "true"` (2026-09-23)
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — the exemplar test file for the hiding case; also the exemplar for the 2026-09-25 mock-boundary prop-capture exception (`describe("CarouselRecipeCard dismiss accessibility action")`)
- `client/components/home/CarouselRecipeCard.tsx` — the fix under test (label prefix + `accessible={false}` badge); also the `toggleFavourite`/`dismiss` `accessibilityActions` under test by the capture technique
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` — the second exemplar for the 2026-09-25 mock-boundary prop-capture exception (`describe("MealSlotItem accessibility actions")`, `describe("MealSlotSection suggest accessibility action")`); extends this file's own **pre-existing** local `vi.mock("react-native", ...)` override (originally added for `RefreshControl`/`ScrollView` capture) to also capture `Pressable`, rather than adding a second `react-native` mock in the same file
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — `MealSlotItem`'s `confirm`/`remove` and `MealSlotSection`'s `suggest` `accessibilityActions` under test by the capture technique; both components were promoted from un-exported locals to exported symbols solely so the new tests can render them in isolation
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