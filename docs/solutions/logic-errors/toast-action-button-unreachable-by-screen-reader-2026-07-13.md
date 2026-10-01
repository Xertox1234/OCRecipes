---
title: Toast action button is unreachable by VoiceOver/TalkBack
track: bug
category: logic-errors
module: client
tags: [react-native, toast, accessibility, screen-reader]
applies_to: [client/components/Toast.tsx, client/context/ToastContext.tsx]
symptoms: ["Toast action (e.g. Retry) announced to VoiceOver but not reachable/activatable by swipe or focus navigation", "Sighted/touch users can tap the action fine — only screen-reader navigation is affected", "No crash or console warning — the action Pressable renders and is tappable, just unreachable"]
created: '2026-07-13'
severity: medium
---

# Toast action button is unreachable by VoiceOver/TalkBack

## Problem

`Toast.tsx`'s root `<Animated.View accessible accessibilityLabel={message} ...>` wraps the message text AND the optional `action` Pressable in one node. Setting `accessible={true}` on a container collapses its entire subtree into a single VoiceOver/TalkBack focus stop — so the nested action button is never independently focusable, even though the component's own iOS announce effect says "<label> available."

This `action` prop has existed since `client/components/toast-utils.ts` introduced `ToastAction` (PR-era commit `1981f2a4`, ~4 months before discovery), but no call site in the app actually passed `action` to a toast call until `LabelAnalysisScreen.tsx`'s AI-upload-retry toast did — so the defect was dormant and untested end-to-end the entire time. It was found via mobile-reviewer during PR #617's code review, not via any test failure.

## Root Cause

This is the same class of defect as the project's general accessibility rule ("never set `accessible={true}` on a banner/card wrapper that contains an interactive child — put the role/label on the text node and let the Pressable stay its own a11y node"), but that rule predates this specific instance and wasn't checked against `Toast.tsx` itself because no real usage had exercised the `action` path before.

The mitigating factor in the discovering PR: `LabelAnalysisScreen.tsx` also renders a persistent, independently-reachable on-screen "Retry" button (not nested in an `accessible` container), so screen-reader users have a working alternate path — the toast's own action affordance is the only broken piece, not the whole retry flow.

## Solution

Fixed 2026-09-23. `Toast.tsx`'s root `Animated.View` now carries only layout, animation and the swipe gesture. An inner `View` holds `accessible`, the role, `accessibilityLabel={message}` and `accessibilityLiveRegion="polite"`, and wraps the icon and the text. The action `Pressable` is that group's **sibling**, so on iOS the toast is two focus stops, and an action-less toast is one grouped node. Android does **not** collapse an `accessible` wrapper (device-verified 2026-08-04 on `FlagSections`; see `CapturedPhotos.tsx`). Left alone, TalkBack would read the group label and then the message text again. So the icon and the message text carry `importantForAccessibility="no-hide-descendants"` (on a leaf it behaves like `"no"`, and the jsdom mock maps it to `aria-hidden`, so the text's removal is test-pinned). The group's label is the same message string, so nothing is lost. Not yet verified on an Android device.

An action toast also stays up for 10s instead of 5s while a screen reader is on (`useAccessibility().screenReaderEnabled`). The user has to swipe to the action before activating it, and 5s was not enough time for that.

Tests in `client/components/__tests__/Toast.test.tsx` → "screen-reader reachability". The jsdom harness drops `accessible` itself, so the tests assert where the **label** is: exactly one node carries the message label, and that node does not contain the action button. A mutant that drops `accessible` from the inner group still passes. That is the documented harness limit (`../conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`).

## Prevention

When adding the FIRST real caller of a long-dormant prop/parameter on a shared component, treat it as a fresh feature activation, not "just passing an existing prop" — verify the underlying implementation actually works end-to-end (including non-visual channels: screen reader, reduced motion) rather than assuming months-old, seemingly-designed-for-this code path is proven.

## Related Files

- `client/components/Toast.tsx` — the `accessible accessibilityLabel={message}` root and the nested `action` Pressable
- `client/context/ToastContext.tsx` — `useToast()`, the provider rendering `Toast`
- `client/components/toast-utils.ts` — `ToastAction` interface
- `client/screens/LabelAnalysisScreen.tsx` — first real caller passing `action` to `toast.error(...)`

## See Also

- [../design-patterns/toast-with-action-button-undo-2026-05-13.md](../design-patterns/toast-with-action-button-undo-2026-05-13.md) — the design-pattern doc for this feature, corrected to note this gap
