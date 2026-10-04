---
title: "iOS: toasts render beneath native-stack modals — the one Toast host sits in the root view controller's views, so toasts raised while Scan, LabelAnalysis or another modal route is up are never seen"
status: done
priority: medium
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, react-native, ios, accessibility]
github_issue:
---

# Toast hidden under native-stack modals on iOS

## Summary

The app's one toast host renders as a sibling of the whole navigator (`client/context/ToastContext.tsx:72-86`; provider above `NavigationContainer`, `client/App.tsx:88-99`), so on iOS it sits in the root view controller's views, beneath every `modal`/`fullScreenModal` route (each presented as its own view controller). While any of the 25 native-modal routes is up, every toast — #1216's "Coach replied", the global error net's, in-modal failures — very likely draws underneath, unseen. Prove it on the iOS simulator against a positive control, then wrap the host, on iOS only, in react-native-screens' `FullWindowOverlay` with a nested, touch-transparent `GestureHandlerRootView`.

## Background

- Noticed during the `/todo` sweep PR #1216 (`5f98465c`, Coach reply toast + unread dot); verified 2026-10-02 against main `ec26b972` and upheld by an adversarial re-check. What was verified is the static structure; the hidden rendering was not observed on a device — it rests on #1209's device-verified mechanism for this identical root position (`docs/solutions/logic-errors/bottom-sheet-from-native-modal-screen-renders-under-the-modal-2026-10-01.md:27`). Deferred because the host predates #1216 (which only added a producer) and the outcome needs a simulator session, which the owner asked on 2026-10-02 to hold for a session with them present (see Risks).
- Structure: `client/components/Toast.tsx:200-212`'s `position: "absolute"` + `zIndex: 9999` only orders siblings inside the root view, and the toast host sits in no RN `Modal` and no `FullWindowOverlay` (`grep -rn FullWindowOverlay client` finds nothing). RN `Modal` itself is used by 9 components (e.g. `client/components/UpgradeModal.tsx`, which a comment at `client/screens/ScanScreen.tsx:1024-1025` calls "a RN <Modal> in its own native window"), so a toast raised while one is open is likely hidden the same way; the post-fix check should open one such surface (e.g. UpgradeModal) as well and record the result. The native root stack (`client/navigation/RootStackNavigator.tsx:2,194`) has 25 modal-family `presentation:` lines (264-493), e.g. Scan (`fullScreenModal`, 258-269), LabelAnalysis (`modal`, 365-372), RecipeChat (`fullScreenModal`, 460-468; toasts at `client/screens/RecipeChatScreen.tsx:395`). Android's native-stack `modal` is not a separate window (#1209 doc :75): iOS only.
- #1209's `withSheetProvider` (`RootStackNavigator.tsx:196-206`) adds only a `BottomSheetModalProvider`, on 4 routes. Per-modal `ToastProvider`s in that style cannot fix the coach toast: `CoachReplyToastBridge` (`client/navigation/MainTabNavigator.tsx:122-139`) calls `useToast()` from under Main, so it always resolves the ROOT provider; a provider in a modal's `layout` only catches that modal's own subtree. The app-wide bridges at `App.tsx:103-105` publish through the root too (`client/components/QueryErrorToastBridge.tsx:21-22`, `client/components/SessionExpiryBridge.tsx:33`, `client/components/OfflineQueueBridge.tsx:10`). The host must be lifted, not duplicated.
- Severity (medium): for the coach toast alone the tab dot is the durable signal (low). Medium because the same host carries every toast, including the failure copy `docs/rules/client-state.md:14` mandates and the global net's (`client-state.md:10`). Toast-only failures that fire while a modal is up: `client/screens/ScanScreen.tsx:364` (log failure; the confirm card only stops spinning, 363), `client/screens/LabelAnalysisScreen.tsx:303` (log failure; `meta: { silentError: true }` at 306; 292-294 note `setError` would never render) and `:375` (verification submit). Adversarial re-check correction: `LabelAnalysisScreen.tsx:259` is not toast-only (a banner repeats its copy, 686-702) — a probe surrogate, not a severity example.

## Acceptance Criteria

- [x] **Pre-fix device check (decides whether this is a bug)** — done 2026-10-04 with a scratch toast trigger instead of the Coach flow (see Updates) — agent-run on the iOS simulator (Maestro or verify-ui: screenshots + a11y snapshot) in a session with the owner present, on main's JS, signed in as a **free-tier** user (demo/demo123 is premium; see notes) with `npm run server:dev` and a real AI key: Coach tab (`tab-coach`) → "Start new chat" → send a prompt with a long answer → **Back to ChatList** → "Open scan menu" → "Scan Barcode" (or `ocrecipes://scan`) → keep Scan up past the reply plus the toast's 5 s life (time it in the control run). Expect no "Coach replied — tap to open" toast in any screenshot while Scan is up; after closing Scan, the Coach tab dot (screenshot) and the tab label "Coach, new reply" (a11y snapshot). **Positive control** — same build and steps, but switch to the Home tab (`tab-home`) instead of opening Scan: the toast appears at the top with "Open". No toast without a passing control proves nothing. Cheaper, probe-only surrogate for the modal half: the `LabelAnalysisScreen.tsx:259` error toast inside the LabelAnalysis modal (preconditions in the notes).
- [x] `client/context/ToastContext.tsx`: on iOS (`Platform.OS` read at render time) the host renders as `FullWindowOverlay` (`unstable_accessibilityContainerViewIsModal={false}`) > `GestureHandlerRootView` (`pointerEvents="box-none"`) > `Toast`; on Android exactly as today, with no `FullWindowOverlay` (it warns and degrades to a View there, `node_modules/react-native-screens/src/components/FullWindowOverlay.tsx:29-31`). It still mounts only while a toast shows (the `toasts.length > 0` guard), and the `key` moves from `<Toast>` (77) to the wrapper.
- [x] `test/mocks/react-native-screens.ts` exports a `FullWindowOverlay` double rendering a `div` (`data-testid="full-window-overlay"`) that mirrors the native accessibility default — `aria-modal="true"` unless `unstable_accessibilityContainerViewIsModal === false` — and its header's list of covered exports names it and its consumer.
- [x] `client/context/__tests__/ToastContext.test.tsx` (new) renders the real `ToastProvider` via `renderComponent` with a child that raises `info("Coach replied — tap to open", { action: { label: "Open", onPress } })`, and asserts:
  - iOS: the message and the "Open" button render inside `full-window-overlay`, the overlay has no `aria-modal`, and the recorded `GestureHandlerRootView` props include `pointerEvents: "box-none"`;
  - control: a bare mock `<FullWindowOverlay>` renders `aria-modal="true"` (else "no `aria-modal`" can never fail);
  - Android (`RN.Platform.OS = "android"`, restored in `afterEach`): the toast renders and no `full-window-overlay` node exists;
  - no overlay node before the first toast or after `dismiss()`; replacing toast A with toast B (no dismiss between) yields a different overlay node (`not.toBe`), pinning the per-toast key.
- [x] **Post-fix device check** — done 2026-10-04 (see Updates; pass-through proven on Home, as Scan's chips are inert on the simulator) (same session and dev-client build): with the branch's JS the pre-fix flow shows the toast ABOVE Scan; "Open" opens that conversation (the root `{ pop: true }` dismisses Scan, `MainTabNavigator.tsx:96-105`); in a second run a swipe up dismisses it; while a toast is up, a Scan control below the toast's strip still responds (the close button, `ScanScreen.tsx:815-827`, sits under the strip — not a pass-through probe); the Home-tab control behaves as before.
- [ ] **Post-fix VoiceOver check** — NOT runnable on the simulator; moved to `todos/P2-2026-10-04-toast-overlay-voiceover-device-check.md` (same session): a toast raised over Scan is spoken and, while it is up, VoiceOver can still reach Scan's controls (the overlay is not accessibility-modal); record whether focus jumped to the toast (see Risks).

## Implementation Notes

- **The change** — a module-local wrapper in `ToastContext.tsx`; `Toast.tsx` is untouched:

  ```tsx
  import { Platform } from "react-native";
  import { FullWindowOverlay } from "react-native-screens";
  import { GestureHandlerRootView } from "react-native-gesture-handler";

  /** iOS presents modal routes above the root view controller, where this
   *  provider's host lives: lift the host onto the key window. */
  function ToastHost({ children }: { children: React.ReactElement }) {
    if (Platform.OS !== "ios") return children;
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
        <GestureHandlerRootView pointerEvents="box-none">
          {children}
        </GestureHandlerRootView>
      </FullWindowOverlay>
    );
  }
  // provider render (75-84): the key moves to the wrapper; Toast props unchanged
  {
    toasts.length > 0 && (
      <ToastHost key={toasts[0].id}>
        <Toast /* … */ />
      </ToastHost>
    );
  }
  ```

  `FullWindowOverlay` is a public export (`node_modules/react-native-screens/src/index.tsx:40`); its README asks for one root child View (`node_modules/react-native-screens/README.md:199-201`). React context flows through it, so `useSafeAreaInsets` (`Toast.tsx:62`) keeps working, and it is window-sized (`FullWindowOverlay.tsx:33-35`), so `top: insets.top + Spacing.sm` (`Toast.tsx:136`) still clears the notch.

- **`unstable_accessibilityContainerViewIsModal={false}` is required.** The native default is modal (`node_modules/react-native-screens/src/fabric/FullWindowOverlayNativeComponent.ts:10`, `WithDefault<boolean, true>`; `node_modules/react-native-screens/ios/RNSFullWindowOverlay.mm:114`); the JS wrapper forwards the prop only when given (`FullWindowOverlay.tsx:24,36-38`). At the default, VoiceOver ignores everything but the toast for its 3-10 s life (`Toast.tsx:49-52`).
- **`pointerEvents="box-none"` must be explicit.** The overlay's container returns only a hit subview, nil otherwise (`RNSFullWindowOverlay.mm:28-67`), so the child decides pass-through. `GestureHandlerRootView` is a `View` with default `flex: 1` (`node_modules/react-native-gesture-handler/src/components/GestureHandlerRootView.tsx:21,26-28`), window-sized here; a native View with default pointer events returns itself for any point inside it (`node_modules/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:633-662`) — every tap, while a toast is up — and `box-none` returns only a hit child (665-676). Fabric may flatten that prop-less View today (`node_modules/react-native/ReactCommon/react/renderer/components/view/ViewShadowNode.cpp:49-73`), but a `testID` (70) would make it real.
- **What the nested `GestureHandlerRootView` does not do on iOS:** it is a plain View plus RNGH's context (`GestureHandlerRootView.tsx:10-24`); RNGH's root recognizer needs an `RCTSurfaceView` ancestor (`node_modules/react-native-gesture-handler/apple/RNGestureHandlerManager.mm:244-253,285-287`), and the overlay's container sits on the key window (`RNSFullWindowOverlay.mm:141-144`), so it gets none either way. The Pan's own recognizer still attaches to the toast view (#1209 saw a sheet's drag work in a `fullScreenModal` without an extra root view, doc :50). Kept for `Toast.tsx:101`'s `Gesture.Pan()`; only the post-fix device check proves swipe and tap.
- **Why the `key` moves to the wrapper:** `show()` replaces the single slot in place (`ToastContext.tsx:40-46`), so back-to-back toasts never unmount the host. Keyed, each toast mounts its own overlay, whose container joins the key window at mount (`RNSFullWindowOverlay.mm:141-144`; recycled: :174-178, :203) instead of reusing one attached before a later modal opened.
- **Render-test recipe:** `// @vitest-environment jsdom` + `renderComponent` (`test/utils/render-component.tsx`), as in `client/components/__tests__/Toast.test.tsx:1-6`; no test renders the real `ToastProvider` yet. `react-native-screens` resolves to the alias mock (`vitest.config.mts:145-147`), which lacks `FullWindowOverlay` — the iOS render would crash on an undefined element. The shared RNGH mock's `GestureHandlerRootView` drops its props (`test/mocks/react-native-gesture-handler.ts:61-66`), so record them in a test-local `vi.mock("react-native-gesture-handler", async (importOriginal) => ({ ...(await importOriginal()), GestureHandlerRootView: recordingDouble }))` over a `vi.hoisted` array (precedent: `client/screens/__tests__/ScanScreen.test.tsx:138`). Switch platform by assigning `RN.Platform.OS` and restoring it in `afterEach` (`client/camera/components/__tests__/CoachHint.test.tsx:23-29`) — hence the render-time `Platform.OS` read.
- **Device-run notes:**
  - JS-only: `RNSFullWindowOverlay` is in the installed RNScreens 4.16.0 pod (`ios/Podfile.lock:3114`; codegen map `node_modules/react-native-screens/package.json:165-171`), so main's and the branch's JS compare in one dev-client build.
  - Account: only ChatScreen's send raises this toast (`useSendMessage(…, { notifyWhenAway: true })`, `client/screens/ChatScreen.tsx:304`), and the Coach tab opens ChatList only for free tier (`client/navigation/ChatStackNavigator.tsx:61,112`, `client/navigation/coachInitialRoute.ts:8-12`); premium users (demo/demo123) land on CoachPro, whose chat never raises it. Register a fresh account on the local dev DB instead (new users default to `free`, `shared/schema.ts:82`; `e2e/flows/onboarding/complete-onboarding.yaml` scripts it).
  - Flow: the Scan FAB hides off a tab root (`client/components/ScanFAB.tsx:52-56,124`), hence Back; leaving the chat clears the viewed marker (`client/hooks/useCoachUnreadReplies.ts:111-118`), so `noteCoachReplyFinished` raises toast and dot (149-156). "Scan Barcode" → `Scan` (`client/components/home/action-config.ts:20-21`); deep link `client/navigation/linking.ts:260-263`. The dot is `accessible={false}` (`MainTabNavigator.tsx:277-286`) — screenshot it; the tab label (263-265) is the a11y signal. Steps to borrow: `e2e/flows/home/chat.yaml`, `e2e/flows/scan/scan-barcode.yaml` (neither asserts a toast).
  - Surrogate: `LabelAnalysisScreen.tsx:259` fires only with a local OCR preview (`localOCRText`, passed to LabelAnalysis only by the label-mode shutter at `client/screens/ScanScreen.tsx:601-613`, parsed at `LabelAnalysisScreen.tsx:178-189`) and then a failed upload (stop the dev server once the preview renders); watch for the toast, not the banner (686-702). The iOS Simulator has no usable camera (`client/camera/components/CameraView.ios.tsx:211-213` renders `<CameraUnavailable />`), so this surrogate likely needs a device.

## Scope Contract

- **Mechanisms to use:** react-native-screens' public `FullWindowOverlay` (installed 4.16.0) with `unstable_accessibilityContainerViewIsModal={false}`; RNGH's `GestureHandlerRootView` with `pointerEvents="box-none"`; a render-time `Platform.OS` branch in one module-local `ToastHost` wrapper; the Vitest alias-mock pattern (`test/mocks/react-native-screens.ts`) and a test-local `vi.mock` recording double. Nothing new in the app beyond the wrapper.
- **Files in scope:** `client/context/ToastContext.tsx`, `client/context/__tests__/ToastContext.test.tsx` (new), `test/mocks/react-native-screens.ts`. Codify step only: `docs/solutions/logic-errors/bottom-sheet-from-native-modal-screen-renders-under-the-modal-2026-10-01.md` (its :52 alternative-fix paragraph and Scope notes, 73-76) may record that the toast host took the overlay route, and why. `client/components/Toast.tsx` and `test/mocks/react-native-gesture-handler.ts` are deliberately out of scope.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking: #1216 (`5f98465c`) and #1209 (`b85d950e`) are merged.
- The device criteria need the owner's session, a booted iOS simulator with the dev-client build, a free-tier login, and the dev server with an AI key.
- Cited library lines are react-native-screens 4.16.0, react-native-gesture-handler 2.28.0 and react-native 0.81.5 as installed at `ec26b972`; re-read them after a bump (the `unstable_` prop could be renamed).

## Risks

- **Owner-present rule (2026-10-02):** the owner asked that simulator passes wait for a session with them present. The probes are agent-run (Maestro or verify-ui) in that session, never handed to the owner as manual steps. An executor running this unattended implements the fix and the render test, leaves the three device criteria unchecked for the owner's session, and says so in the PR body; the PR is medium priority, so it is not auto-merge-eligible.
- **Not-a-bug exit:** if the pre-fix check shows the toast visible above Scan while the Home-tab control passes, the premise is wrong — archive this todo as not-a-bug (an Updates entry recording what the screenshots showed) and close any fix PR unmerged. If the control itself fails, the run proves nothing; fix the setup and re-run.
- **Touch blocking:** losing `box-none` (or wrapping in a View that hit-tests itself) can make the whole app untappable for every toast's lifetime; the render test pins the prop and the post-fix check proves pass-through.
- **VoiceOver focus move:** mounting the overlay posts `UIAccessibilityLayoutChangedNotification` on its container (`RNSFullWindowOverlay.mm:156`), which can pull VoiceOver focus to the toast; today it only announces (`Toast.tsx:79-86`). Expect a change for VoiceOver users (a focus jump, maybe double speech); record it — changing it is a follow-up decision, not this todo's scope.
- **Gestures inside the overlay are unproven** until the post-fix check (no RNGH root recognizer, see notes); if swipe-dismiss fails while Open works, report it rather than ship it silently.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.

### 2026-10-04

- Executor (unattended) implemented the fix: `ToastHost` in `client/context/ToastContext.tsx` (iOS-only `FullWindowOverlay` > `GestureHandlerRootView pointerEvents="box-none"`), a `FullWindowOverlay` double in `test/mocks/react-native-screens.ts`, and new `client/context/__tests__/ToastContext.test.tsx`.
- Left unchecked for the owner-present simulator session (per Risks): the pre-fix device check, the post-fix device check and the post-fix VoiceOver check.

### 2026-10-04 (device verification, owner present)

- iPhone 17 Pro simulator, iOS 26.5, fresh dev-client build. The Coach flow could not create the "away" precondition by script (the reply lands in ~6 s, before Maestro leaves the chat; free tier allows 3 messages a day), so both runs used the same uncommitted scratch trigger: `ToastProvider` raised an `info` toast with an "Open" action on a timer. Identical trigger on `main` (f7024bd0) and on this branch (a55c7196).
- Pre-fix (`main`): the toast shows on Home before and after; 16 frames over Scan (32 s, `simctl io` framebuffer) show none. Bug confirmed — the not-a-bug exit does not apply.
- Post-fix (this branch): the toast shows above Scan; swipe-up dismisses it; with a toast up, a tap on a Home control below the strip lands (the section collapsed); the action button fires and a toast raised from it 300 ms later shows. Scan's close button sits under the strip while a toast is up, as predicted.
- Tooling notes: Maestro's accessibility tree and its `takeScreenshot` can miss the overlay toast — judge visibility from `xcrun simctl io <UDID> screenshot`, and pass the UDID (two simulators were booted; `booted` picked the wrong one).
- VoiceOver cannot run on the simulator — moved to `todos/P2-2026-10-04-toast-overlay-voiceover-device-check.md` (human-led).
