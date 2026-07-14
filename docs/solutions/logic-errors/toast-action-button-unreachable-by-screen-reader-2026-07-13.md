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

Not yet fixed (tracked as a follow-up, not bundled into the discovering PR since `Toast.tsx` is a shared, widely-used component). The correct fix, per the reviewing agent:

- Keep the *message* group `accessible={true}` for the existing grouped-announcement/Android-live-region behavior that every action-less toast call site relies on.
- Move the `action` Pressable to be a **sibling** outside that accessible scope (or expose it via `accessibilityActions`/`onAccessibilityAction` on the parent) rather than a descendant of the same `accessible={true}` node.
- A naive removal of `accessible` from the root would regress the grouped-announcement behavior for every existing (action-less) toast call site — do not do that.
- Add a render/accessibility test asserting the action Pressable is independently focusable when `action` is passed, so a future regression is test-caught, not review-caught.

## Prevention

When adding the FIRST real caller of a long-dormant prop/parameter on a shared component, treat it as a fresh feature activation, not "just passing an existing prop" — verify the underlying implementation actually works end-to-end (including non-visual channels: screen reader, reduced motion) rather than assuming months-old, seemingly-designed-for-this code path is proven.

## Related Files

- `client/components/Toast.tsx` — the `accessible accessibilityLabel={message}` root and the nested `action` Pressable
- `client/context/ToastContext.tsx` — `useToast()`, the provider rendering `Toast`
- `client/components/toast-utils.ts` — `ToastAction` interface
- `client/screens/LabelAnalysisScreen.tsx` — first real caller passing `action` to `toast.error(...)`

## See Also

- [../design-patterns/toast-with-action-button-undo-2026-05-13.md](../design-patterns/toast-with-action-button-undo-2026-05-13.md) — the design-pattern doc for this feature, corrected to note this gap
