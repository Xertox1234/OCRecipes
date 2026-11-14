---
title: A modal screen's loading, error and permission early returns skip accessibilityViewIsModal — VoiceOver reaches the screen behind
track: bug
category: logic-errors
tags: [accessibility, voiceover, ios, modal, accessibilityViewIsModal, react-navigation, early-return]
module: client
applies_to: ["client/screens/**/*.tsx"]
symptoms: ["While a modal route shows its loading spinner, error-with-retry or permission prompt, VoiceOver swipes past its controls onto the screen underneath", "Focus is contained only once the main content renders", "The route is registered with presentation: \"modal\" or \"fullScreenModal\" and the main return already has accessibilityViewIsModal"]
created: 2026-11-06
last_updated: 2026-11-06
severity: high
---

## Problem

A React Navigation `modal` / `fullScreenModal` screen that renders state-specific early returns (`if (isPending) return <Loading/>`, `if (isError) return <Retry/>`, `if (!permission) return <Prompt/>`) carried `accessibilityViewIsModal` only on its final, happy-path return. Each early return roots in a different `View`, so in those states the modal does not confine VoiceOver.

## Symptoms

- The 2026-11-06 accessibility audit found it on three screens at once: ReceiptReview (4 early returns), ReceiptCapture (3) and PhotoAnalysis (the analyzing state, and the main root too — only a nested follow-up sheet sub-component had the prop, which a grep for the prop name made look covered).
- Sibling screens (MenuScanResult, DailyNutritionDetail, LabelAnalysis, EditDietaryProfile, CookSessionCapture) already put the prop on every return, so the rule was known; the miss is structural.

## Root Cause

`docs/rules/accessibility.md` says "on the root container", but a screen with early returns has one root **per return path**. Adding a new loading/error branch copies the `styles.centered` view from a sibling branch, never the main return's props.

## Solution

Put `accessibilityViewIsModal` on the outermost element of **every** `return (` in the screen component — loading, error, empty, permission and prompt states included. Test each state through the mock, which maps the prop to `aria-modal`:

```tsx
const modalRootOf = (text: string) =>
  screen.getByText(text).closest('[aria-modal="true"]');
expect(modalRootOf("Analyzing receipt...")).not.toBeNull();
```

Precedent tests: `client/screens/__tests__/ReceiptReviewScreen.a11y.test.tsx`, `ReceiptCaptureScreen.test.tsx` ("modal containment in every state"), `PhotoAnalysisScreen.test.tsx`.

## Prevention

- When reviewing a modal-route screen, list every top-level `return (` in the component and check each root — grep for the prop name is not enough (a nested sub-component's own return can hold the only hit).
- When adding an early return to a modal screen, copy the main return's root a11y props, not a sibling branch's style.

## Related Files

- `client/screens/ReceiptReviewScreen.tsx`, `client/screens/ReceiptCaptureScreen.tsx`, `client/screens/PhotoAnalysisScreen.tsx`
- `test/mocks/react-native.ts` (`ariaModalProps`)

## See Also

- `docs/solutions/logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md`
- `docs/solutions/conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md`
