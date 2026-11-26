---
title: "Coach barcode scanner: count only the code inside the viewfinder"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, camera]
github_issue:
---

# Coach barcode scanner: count only the code inside the viewfinder

## Summary

The paced Coach barcode scanner (client/screens/CoachBarcodeScanScreen.tsx)
locks when the same product code holds for `LOCK_THRESHOLD_FRAMES` frames.
It counts a read from anywhere in the camera frame, though the screen asks
the user to put the code in the 260×160 viewfinder. The mobile review of the
pacing change raised this as non-blocking.

## Background

- With two product barcodes in view (a shelf, a multipack), the decoder can
  report A, B, A, B on alternate frames. Each switch resets the hold to one
  frame, so the corners flap and the lock may never land.
- A code at the edge of the frame can lock while the viewfinder is empty.

`BarcodeResult` carries `bounds` (see client/camera/components/CameraView.tsx).

## Acceptance criteria

- [ ] Only a code whose bounds centre falls inside the viewfinder counts, or
      the code nearest the centre wins when several are decoded.
- [ ] A test in client/screens/**tests**/CoachBarcodeScanScreen.test.tsx
      covers two alternating codes still locking on the centred one.
