---
title: navigate() vs replace() in modal flows
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, modal, replace, sequential-flows]
applies_to: [client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-09-24'
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

**Refinement (2026-09-24) — the fixed-depth `pop(n)` exception is not "always use `navigate()`"; it depends on which screen the `pop(n)` is trying to land on.** Two sub-cases, easy to conflate:

- **(a) The current screen IS the `pop(n)`'s intended destination** (the LabelAnalysis case above): `replace()` would remove it from the stack, so keep `navigate()` (push) — it leaves the current screen in place for the eventual `pop(n)` to land on.
- **(b) The current screen is itself a consumed step, and an ALREADY-EXISTING instance of the target screen sits directly beneath it on the stack.** `FrontLabelConfirmScreen`'s own "Retake" button is this case: a `Scan(front-label)` instance already exists just below `FrontLabelConfirm` (it's what pushed FrontLabelConfirm in the first place). The naive fix — mirroring case (a) by changing `replace()` to `navigate()` — is wrong here: it pushes a *third* level (`FrontLabelConfirm, Scan#1, Scan#2`), still leaving the eventual `pop(2)` one screen short, just on a different wrong screen (the stale, consumed `FrontLabelConfirm` instance instead of a live camera). The correct fix is `goBack()`/`pop()` back onto the *existing* instance — never push a duplicate of a screen that's already there.

Diagnostic: trace the stack shape and ask whether the `pop(n)`'s target **is** the current screen (→ `navigate()`/push, case a) or is something the current screen's **own entry already pushed beneath it** (→ `goBack()`/`pop()` onto the existing instance, case b). Do not apply the 2026-09-23 exception's "use `navigate()`" conclusion without first checking which case applies. See `todos/archive/P3-2026-09-23-front-label-retake-replace-skips-scan-level.md` for the full trace of both stack shapes side by side.

## Related Files

- `client/screens/ReceiptCaptureScreen.tsx` → ReceiptReview
- `client/screens/CookSessionCaptureScreen.tsx` → CookSessionReview
- `client/screens/CookSessionReviewScreen.tsx` → SubstitutionResult
- `client/screens/BatchScanScreen.tsx` → BatchSummary
- Existing correct usage: `ReceiptReviewScreen`
- `client/screens/LabelAnalysisScreen.tsx` — **no longer** uses `replace()` for its front-label CTA (2026-09-23) — see the Exceptions entry above. Do not reintroduce `replace()` there.
- `client/screens/FrontLabelConfirmScreen.tsx` — its "Retake" button uses `goBack()` (2026-09-24, case (b) above), **not** `replace()` or `navigate()`. Do not reintroduce either there.

## See Also

- [Dismiss-then-navigate: modal to another screen](../design-patterns/dismiss-then-navigate-modal-to-screen-2026-05-13.md)
