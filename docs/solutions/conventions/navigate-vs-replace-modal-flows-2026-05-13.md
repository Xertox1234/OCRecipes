---
title: navigate() vs replace() in modal flows
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, modal, replace, sequential-flows]
applies_to: [client/screens/**/*.tsx]
created: '2026-05-13'
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

## Related Files

- `client/screens/ReceiptCaptureScreen.tsx` → ReceiptReview
- `client/screens/CookSessionCaptureScreen.tsx` → CookSessionReview
- `client/screens/CookSessionReviewScreen.tsx` → SubstitutionResult
- `client/screens/BatchScanScreen.tsx` → BatchSummary
- Existing correct usage: `FrontLabelConfirmScreen`, `LabelAnalysisScreen`, `ReceiptReviewScreen`

## See Also

- [Dismiss-then-navigate: modal to another screen](../design-patterns/dismiss-then-navigate-modal-to-screen-2026-05-13.md)
