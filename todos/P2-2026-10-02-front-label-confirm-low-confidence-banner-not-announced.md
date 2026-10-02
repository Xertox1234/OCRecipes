---
title: "FrontLabelConfirm: the low-confidence banner is never announced to screen readers (the AI-update toast reaches TalkBack only), and the upload/save error banners are silent on TalkBack"
status: backlog
priority: medium
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, accessibility]
github_issue:
---

# FrontLabelConfirm low-confidence banner not announced

## Summary

The low/medium-confidence banner in `client/screens/FrontLabelConfirmScreen.tsx:295-322` is the screen's only warning that the AI's brand/product/weight read may be wrong before "Looks Good" saves it, and no screen reader is told when it appears. Its only a11y prop is `accessibilityRole="alert"`, which announces nothing, and nothing announces the local → AI upgrade that puts it on screen. Mirror #1215 (`2562ba5e`): compute the banner copy once, announce the upgrade as ONE ungated utterance (the "Updated with AI analysis" toast copy, then the banner copy), and remove the toast's Android-only live region. Also in this file: the upload-error and save-error announces are iOS-only with no Android live region behind them, so TalkBack hears neither error. Route both through `InlineError`.

## Background

- Bare `:N` line refs point into `client/screens/FrontLabelConfirmScreen.tsx` at `ec26b972`, unless the same sentence names another file.
- Noticed during the `/todo` sweep PR #1215 (LabelAnalysis low-confidence banner announce, squash `2562ba5e`). Verified 2026-10-02 against main `ec26b972` and upheld by an adversarial re-check. Deferred because #1215's Scope Contract covered only `LabelAnalysisScreen` and its tests (`todos/archive/P2-2026-09-25-label-analysis-low-confidence-error-dead-branch.md:61-67`), and `git show 2562ba5e --stat` lists no FrontLabelConfirm file.
- **What a screen-reader user gets today:** the banner renders when `dataSource === "ai"` and the tier is low or medium (`:296-299`; tiers at `client/lib/confidence.ts:8-15`: high ≥ 0.8, medium ≥ 0.5). The banner has no live region. Its `accessibilityRole="alert"` (`:307`) posts no announcement on iOS (`docs/rules/accessibility.md:21`); on Android RN adds only a role description, no live region (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.java:394-395`). The file has three announces: upload error (`:163`), save success (`:188`) and save error (`:201`). None mentions confidence or fires on the upgrade. The banner copy has been unchanged since #607 (`eabac728`), which replaced the original single `< 0.7` string with the tiered copy.
- **The toast** (`:267-278`): its `accessibilityLiveRegion="polite"` (`:272`, added in `a46cbded`) makes TalkBack read it. VoiceOver hears nothing, because live regions are Android-only (`docs/rules/accessibility.md:21`). Once its copy is part of an ungated imperative announce, that live region must go, or TalkBack speaks it twice (`docs/rules/accessibility.md:22`).
- **Why ONE utterance:** the upload success callback calls `setData` (`:148`), `setShowUpdatedToast(true)` (`:150`), `setSessionId` (`:154`) and `setDataSource("ai")` (`:156`) synchronously, so all four land in one batched commit and the toast and banner appear together. Two announces in one commit collide on iOS (`docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`). That doc's second-adopter section (`:96-114`) describes the #1215 shape this todo copies.
- **Extra finding (same file, same announce family, verified in the same pass):** the upload-error and save-error announces are wrapped in `Platform.OS === "ios"` (`:162-164`, `:200-202`). Their banners (`:280-293`, `:389-401`) have `accessibilityRole="alert"` but no live region. `docs/rules/accessibility.md:22` allows the iOS gate only when an Android live region covers the same change, so TalkBack hears neither error.
- `client/screens/__tests__/FrontLabelConfirmScreen.test.tsx` has no announce or live-region assertion, and both describes pass `sessionId: "session-1"` to skip the upload effect (`:52-66`, `:108-122`), so the upgrade path is untested.
- Medium, matching #1215's own todo (`priority: medium`).

## Acceptance Criteria

- [ ] **Copy computed once.** The screen derives `confidenceBannerMessage` in render. It is null unless `dataSource === "ai"` and the tier of `data.confidence` is low or medium. The banner renders it in place of the inline ternary (`:316-318`). Both visible strings stay byte-identical to today's.
- [ ] **One announce on the upgrade.** In `FrontLabelConfirmScreen.test.tsx`, a new describe uses a `sessionId: null` route with a resolved upload. Each row first `findByText`s what will be spoken (the denominator), then asserts the exact string via `waitFor` and `toHaveBeenCalledTimes(1)`. Rows 1-3 fail on main:
  1. Toast and low banner: "Updated with AI analysis. Low confidence — review carefully before saving".
  2. No toast and medium banner (the AI confirms a medium local preview): "Some details may be inaccurate — review before saving".
  3. Toast and high tier: "Updated with AI analysis".
  4. No toast and high tier: `announceForAccessibility` is never called. Before asserting that, the "Verifying with AI — Confirm will enable shortly" hint is gone, which proves the upgrade happened.
- [ ] **Ungated on Android.** Row 1 with `RN.Platform.OS = "android"` announces the same string exactly once. The OS is restored in `afterEach`. Fails on main.
- [ ] **No repeat.** After row 1's announce, an unrelated `rerender` leaves the count at 1.
- [ ] **No live region and no role on the announced surfaces.** The toast's `accessibilityLiveRegion="polite"` (`:272`) and the banner's `accessibilityRole="alert"` (`:307`) are removed. A test asserts both `aria-live` and `role` are null on every node of both surfaces: the toast text and its `Animated.View`, and the banner text and its `View` (the every-node rule, solution doc `:126-132`). Fails on main: the toast container has `aria-live="polite"` and the banner container has `role="alert"`.
- [ ] **Mount decision pinned.** With `route.params.sessionId` set and `data.confidence: 0.3`, the banner renders (`findByText`) and the announcer stays silent. That is the edge-only default (see Implementation Notes). If the executor takes the mount-announce alternative instead, this test asserts one announce of the banner copy, and the PR body says which branch was chosen.
- [ ] **Upload error: one announce per platform.** With a `sessionId: null` route and an upload rejecting with a plain `Error`, the error is announced exactly once by one announcer on each platform. On iOS, `announceForAccessibility` is called once with "Could not analyze front label. Please try again.". On Android, the error's container has `aria-live="assertive"` and `announceForAccessibility` is not called. The Android assertions fail on main.
- [ ] **Save error: one announce per platform, once per failure.** With `sessionId: "session-1"` and `confirmFrontLabel` rejecting, tapping "Looks Good" shows "Failed to save product details". It gets the same two-platform assertions as the upload error. A second failed tap announces once more on iOS, for a total of 2. The Android assertions fail on main.
- [ ] The existing Retake and temp-photo-cleanup tests (`FrontLabelConfirmScreen.test.tsx:46-157`) pass unchanged.

## Implementation Notes

- **The announcer** follows `client/screens/LabelAnalysisScreen.tsx:105-174`. Put both pieces after the state block (`FrontLabelConfirmScreen.tsx:118-130`):

  ```tsx
  // Computed once: rendered by the banner and spoken by the upgrade announcer.
  const confidenceTier =
    dataSource === "ai" ? getConfidenceTier(data.confidence) : null;
  const confidenceBannerMessage =
    confidenceTier === "low"
      ? "Low confidence — review carefully before saving"
      : confidenceTier === "medium"
        ? "Some details may be inaccurate — review before saving"
        : null;

  const prevDataSourceRef = useRef(dataSource); // mount value → silent on mount
  useEffect(() => {
    const upgraded =
      dataSource === "ai" && prevDataSourceRef.current === "local";
    prevDataSourceRef.current = dataSource;
    if (!upgraded) return;
    const parts: string[] = [];
    if (showUpdatedToast) parts.push("Updated with AI analysis");
    if (confidenceBannerMessage) parts.push(confidenceBannerMessage); // caution last
    if (parts.length > 0)
      AccessibilityInfo.announceForAccessibility(parts.join(". "));
  }, [dataSource, showUpdatedToast, confidenceBannerMessage]);
  ```

  Render the banner as `{confidenceTier && confidenceBannerMessage && (() => { … })()}`, as at `LabelAnalysisScreen.tsx:706-728`, with `{confidenceBannerMessage}` as its text.

- **Do not reuse `dataSourceRef` as the edge guard.** `dataSourceRef` (`:128-130`) is set to `"ai"` at `:155`, inside the callback and before the commit, so by the time the effect runs it already reads `"ai"`. The effect needs its own previous-value ref, updated inside the effect, exactly like `prevSessionIdRef` at `LabelAnalysisScreen.tsx:148-151`. That is the house prev-value guard, silent on mount (`docs/rules/accessibility.md:24`). `setSessionId` flips in the same commit, so keying on it would behave the same; the record specifies `dataSource`.
- **The comment must state the invariants (#1215's codified rule, solution doc `:106-110`):**
  - The toast and the banner have no edge of their own. `showUpdatedToast` turns true only in the same callback as `setDataSource("ai")` (`:149-156`).
  - `data` has no writer after `:148`. A later writer of `data` would NOT be re-announced.
  - The announce is ungated because neither surface has a live region. Do not add one.
  - The toast's 3-second hide (`:151`) cannot re-announce, because the guard is the `dataSource` edge.
- **Separator:** unlike LabelAnalysis's, this screen's banner strings (`:317-318`) have no trailing period, so `join(". ")` is clean; do not copy #1215's double-period comment (`LabelAnalysisScreen.tsx:163-165`). Keep the banner last so the caution is heard last.
- **Remove the role along with the toast's live region.** `accessibilityRole="alert"` at `:307` announces nothing (see Background). Removing it lets the both-node pin match #1215's verbatim (`client/screens/__tests__/LabelAnalysisScreen.a11y.test.tsx:472-478` asserts `aria-live` AND `role` are null). It also keeps `getByRole("alert")` unambiguous, since a low banner and a save error can show together. The error banners are rebuilt below.
- **Mount decision:** `dataSource` starts as `"ai"` whenever `route.params.sessionId` is set (`:122-124`). The route type allows that (`client/navigation/RootStackNavigator.tsx:172`), but no production path does it today:
  - Both callers pass `sessionId: null` (`client/screens/ScanScreen.tsx:586-591`, `:938-943`).
  - `client/navigation/linking.ts` has no FrontLabelConfirm entry.
  - Only the existing tests set a session.

  The default is edge-only, as sketched above: on mount the banner sits in swipe order right after the photo, and nothing changes under the user's focus. The alternative is one token, `useRef<"local" | "ai">("local")`, which treats an `"ai"` mount as an upgrade. That announce would fire in the first commit of a `presentation: "modal"` screen (`RootStackNavigator.tsx:425-432`) and may compete with VoiceOver's screen-change readout. That is unverified, so take it only with a device check.

- **Error banners use `InlineError`.** `docs/rules/accessibility.md:8` is binding ("use the `InlineError` component"), and #1078 (`a44d5f6f`) made the same swap on the sister screen (`LabelAnalysisScreen.tsx:465-469`). `InlineError` provides the iOS announce through a `Platform.OS === "ios"` gated effect keyed on `message` (`client/components/InlineError.tsx:24-28`). It provides the Android announce through `accessibilityRole="alert"` plus `accessibilityLiveRegion="assertive"` (`InlineError.tsx:34-35`). The changes:
  - Replace both custom banners (`:280-293`, `:389-401`) with `<InlineError message={uploadError} />` and `<InlineError message={confirmError} />`.
  - **Delete** the handler announces at `:162-164` and `:200-202`, keeping `setUploadError` and `setConfirmError`. Otherwise iOS hears each error twice (`docs/rules/accessibility.md:23`; `docs/solutions/logic-errors/inlineerror-double-announce-onerror-handler-2026-06-03.md`).
  - Remove the then-unused `Platform` import (`:7`) and the `errorBanner`/`errorText` styles (`:506-512`).
  - `handleConfirm` resets `confirmError` to null before each attempt (`:210`), so `InlineError`'s effect fires once per failure.
  - The visual changes: an `alert-circle` icon, `Spacing.md` padding and a 0.06 tint. `InlineError` takes a `style` override (`InlineError.tsx:18`, `InlineError.tsx:39`) if the owner wants today's padding and tint.

  Zero-visual-change alternative: keep the custom banners, add `accessibilityLiveRegion="assertive"` to both containers, and keep the iOS gates. That is the same contract `InlineError` implements. Plain ungating also satisfies `accessibility.md:22`, but it leaves the errors without the assertive live region that `accessibility.md:8` requires.

- **Test recipe** (`client/screens/__tests__/FrontLabelConfirmScreen.test.tsx`):
  - Imports: add `import * as RN from "react-native"` and `waitFor`.
  - Announce spy: `vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {})`. The mock's method is a no-op (`test/mocks/react-native.ts:400-401`).
  - Platform: `Platform.OS` defaults to `"ios"` (`test/mocks/react-native.ts:6-9`). Restore it in `afterEach`, not in the test body, because of `retry: 2` (`LabelAnalysisScreen.a11y.test.tsx:433-439`).
  - Hoisting: `confirmFrontLabel: vi.fn()` (`FrontLabelConfirmScreen.test.tsx:37`) is outside the hoisted block; lift it into `vi.hoisted` (`FrontLabelConfirmScreen.test.tsx:7-23`) as `mockConfirmFrontLabel` so the save-error test can `mockRejectedValue`. `mockUploadFrontLabelPhoto` (`FrontLabelConfirmScreen.test.tsx:22`) is hoisted but never given a value.
  - `renderComponent` sets `mutations: { retry: false }` (`test/utils/render-component.tsx:12-13`), so `onError` fires on the first rejection.
  - Fixtures follow the toast rule `client/screens/front-label-confirm-utils.ts:16-21` (replace when `ai.confidence > 0.7` or brand/productName/netWeight differ). Each row gives the local `data` (route) → AI result:
    1. local 0.9 "Acme" → AI brand "Acme Foods", 0.3: toast, low banner.
    2. local 0.6 → AI with the same fields, 0.6: no toast, and `data` stays local, so the medium banner comes from the LOCAL 0.6.
    3. local 0.9 → AI brand differs, 0.9: toast, no banner.
    4. local 0.9 → AI with the same fields, 0.6: silent.
  - DOM nodes: the jsdom mocks map `accessibilityRole`/`accessibilityLiveRegion` to `role`/`aria-live` (`test/mocks/react-native.ts:137`, `:142`; for `Animated.View`, `test/mocks/react-native-reanimated.ts:158-160`). Reach a surface's container through `getByText(copy).parentElement`.
  - Timing: wrap the first announce assertion in `waitFor` (#1215's review fix: `findByText` can resolve one passive-effect flush early).

## Scope Contract

- **Mechanisms to use:** the #1215 merged-announcer shape: copy computed once, one previous-value-guarded effect, ungated because nothing has a live region (`client/screens/LabelAnalysisScreen.tsx:105-174`). The existing `InlineError` component (`client/components/InlineError.tsx`), used and not modified. The existing jsdom harness and its a11y prop mapping. Nothing new.
- **Files in scope:** `client/screens/FrontLabelConfirmScreen.tsx`, `client/screens/__tests__/FrontLabelConfirmScreen.test.tsx`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. #1215 (`2562ba5e`) is merged and is the reference implementation, and `InlineError` already exists.
- The RN source line is for `react-native` 0.81.5 as installed at `ec26b972`.

## Risks

- **Adjacent silence, out of scope:** an upgrade with a high-confidence result and no toast still speaks nothing (row 4). The only signal is the Confirm button's label changing (`:419-423`). It is not part of this finding, so do not fix it unasked.
- Removing `accessibilityRole="alert"` from the banner means TalkBack no longer says "Alert" when the banner is focused. The banner text itself carries the caution.
- `InlineError` changes how the two error banners look (icon, padding, tint). Use the `style` override, or the assertive-live-region alternative, if the owner objects.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.
