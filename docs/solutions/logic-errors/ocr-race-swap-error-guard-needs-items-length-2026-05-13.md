---
title: OCR race+swap error guard must also check items.length
track: bug
category: logic-errors
module: client
severity: medium
tags: [ocr, race-condition, error-handling, fallback, graceful-degradation]
symptoms: [User sees error UI even though locally-parsed OCR items were visible, AI failure discards valid OCR results instead of letting them remain, '`scanMutation.isError` flips hard error state when partial results exist']
applies_to: [client/screens/**/*.tsx]
created: '2026-04-28'
---

# OCR race+swap error guard must also check items.length

## Problem

`ReceiptReviewScreen` uses the OCR race+swap pattern: local OCR runs first, AI analysis races to replace it, and a `dataSourceRef` tracks which source "won". The screen was showing a hard error UI whenever `scanMutation.isError` was true, even when `items.length > 0` — discarding valid locally-parsed OCR items that were already visible to the user. This is the same race used in `MenuScanResultScreen`, which correctly checks both conditions.

## Symptoms

- Receipt items appear briefly, then are replaced by an error screen when AI fails
- Local OCR results are valid but get hidden because of an AI-tier failure
- Identical pattern in sibling screen behaves correctly

## Root Cause

The error guard collapses two distinct states into one: "AI failed AND we have nothing to show" vs "AI failed BUT we already have local OCR results." Only the first warrants a hard error UI.

## Solution

Change the error guard to combine the AI-error flag with an empty-items check:

```tsx
// Bad — discards locally-parsed items when AI fails
if (scanMutation.isError) {
  return <ErrorScreen />;
}

// Good — AI failure gracefully degrades to local OCR results
if (scanMutation.isError && items.length === 0) {
  return <ErrorScreen />;
}
```

## Prevention

In OCR race+swap screens, `isError` alone must not trigger the hard error state — always also check `items.length === 0`. AI failure should degrade gracefully to local OCR data, not discard it. When introducing a new race+swap screen, copy the `MenuScanResultScreen` guard verbatim.

## Related Files

- `client/screens/ReceiptReviewScreen.tsx`
- `client/screens/MenuScanResultScreen.tsx` — correct pattern
- Audit 2026-04-28 H4

## See Also

- [Camera scan OCR race-swap state machine](../design-patterns/camera-scan-ocr-race-swap-state-machine-2026-05-13.md)
