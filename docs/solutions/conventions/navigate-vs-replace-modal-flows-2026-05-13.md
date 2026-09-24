---
title: navigate() vs replace() in modal flows
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, modal, replace, sequential-flows]
applies_to: [client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-09-23'
---

# navigate() vs replace() in modal flows

## Rule

Use `navigation.replace()` instead of `navigate()` when the current modal step is "done" and going back to it makes no sense. This prevents deep modal stacking.

## Examples

```typescript
// GOOD — capture is done, move to review (back skips capture)
navigation.replace("CookSessionReview", { sessionId });

// BAD — stacks review on top of capture (back returns to capture)
navigation.navigate("CookSessionReview", { sessionId });
```

## Why

When the user has consumed the previous step (taken the photo, completed the scan), the back button leading them back to the consumed step is confusing — they would re-trigger the camera or scanner unnecessarily. `replace` removes the consumed step from the stack so the back button leads further up the flow.

## Exceptions

When to use `replace()`: Sequential flows where each step consumes the previous (Capture→Review, Scan→Summary, Review→Result).

When to keep `navigate()`: Flows where the user might want to go back and retry (Scan→PhotoIntent, PhotoIntent→PhotoAnalysis — user might want to re-scan or pick a different intent).

When to keep `navigate()` (2026-09-23): also when a screen further up the stack returns via a **fixed-depth `pop(n)`**. `replace()` removes the current screen from the stack and pushes a new one in its place — same stack *length*, but a different *screen* now sits at that depth. A downstream `pop(n)` was counted against the original stack shape, so replacing a screen the `pop(n)` was relying on to still be there makes the `pop(n)` land one screen short of its intended destination — on whatever `replace()` put there instead. `client/screens/LabelAnalysisScreen.tsx`'s front-label CTA hit this exactly: it used to `replace()` itself with `Scan(front-label)`, so `FrontLabelConfirmScreen`'s `pop(2)` (counted assuming LabelAnalysis was still 2 levels up) landed on the live `Scan(label)` camera underneath instead of back on LabelAnalysis. Fixed by using `navigate()` (push) instead, keeping the stack shape the `pop(2)` expects. See `todos/archive/P3-2026-09-23-front-label-after-verification-lands-on-camera.md` for the full trace.

## Related Files

- `client/screens/ReceiptCaptureScreen.tsx` → ReceiptReview
- `client/screens/CookSessionCaptureScreen.tsx` → CookSessionReview
- `client/screens/CookSessionReviewScreen.tsx` → SubstitutionResult
- `client/screens/BatchScanScreen.tsx` → BatchSummary
- Existing correct usage: `ReceiptReviewScreen`
- `client/screens/LabelAnalysisScreen.tsx` — **no longer** uses `replace()` for its front-label CTA (2026-09-23) — see the Exceptions entry above. Do not reintroduce `replace()` there.

## See Also

- [Dismiss-then-navigate: modal to another screen](../design-patterns/dismiss-then-navigate-modal-to-screen-2026-05-13.md)
