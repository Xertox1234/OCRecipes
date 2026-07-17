---
title: "VisionCamera v5 attach-time gotchas: outputs are identity-keyed and attached callbacks outlive React commits"
track: bug
category: logic-errors
tags: [camera, visioncamera, react-native, memoization, stale-closure, barcode]
module: camera
applies_to: [client/camera/**/*.tsx, client/camera/**/*.ts, client/screens/ScanScreen.tsx]
symptoms: [Barcode auto-detection never locks — stuck on "Hold steady" while frames clearly deliver, Phase-gated UI (StepPill) missing because the scan phase machine never progresses, Native camera session audibly/visibly restarting or reconfiguring during normal preview]
created: '2026-07-17'
severity: high
---

# VisionCamera v5 attach-time gotchas: outputs are identity-keyed and attached callbacks outlive React commits

## Problem

Two related failure modes in how VisionCamera v5 outputs attach to React, both
found while diagnosing barcode auto-capture that never locked (PR #654):

1. **Outputs are recreated on array identity, not content.** Both
   `useBarcodeScannerOutput` (Android path) and `useObjectOutput` (iOS path)
   wrap their native-output creation in a `useMemo` keyed on the
   `barcodeFormats`/`types` **array reference**. Our `CameraView` computed
   `mapBarcodeTypes(barcodeTypes)` inline, and `ScanScreen` passes a fresh
   array literal every render — so every parent re-render (which happens per
   processed frame while tracking) tore down and recreated the native output,
   an AVCaptureSession reconfigure on iOS.

2. **The callback the native output holds can outlive the commit that created
   it.** `ScanScreen.onBarcodeScanned` read `scanPhase`/`frameCount` from its
   render closure; a callback still attached to the native output after a
   dispatch but before React re-attaches replays a stale, too-low frame count —
   confidence never crosses the 0.85 lock threshold. The libraries' own
   freshness guarantees differ per platform: `useBarcodeScannerOutput` mirrors
   its callback into a ref **during render** (fresh on Android), while
   `useObjectOutput` refreshes via `setOnObjectsScannedCallback` inside a
   passive **effect** (post-paint window on iOS). Handler code must not depend
   on either behavior.

## Symptoms

- Barcode detection stuck at "Hold steady…" indefinitely; multi-frame
  confidence never accumulates to a lock
- Phase-gated UI absent (the StepPill hides in `IDLE`), which can present as
  "the feature is missing" rather than "the camera is broken"
- Excess native churn: camera output rebuilt on every re-render

## Root Cause

React-side assumptions colliding with attach-time semantics: (1) the library
treats an array prop's identity as "configuration changed — rebuild the native
output," so un-memoized mapping recreates hardware sessions at render cadence;
(2) a handler invoked by native code between commits sees whatever closure it
was attached with, so any state it reads must come through a ref that is
current at call time — mirrored at **render** time, not in an effect
(docs/rules/hooks.md's synchronous-guard exception), because the effect's
post-paint lag reopens the staleness window at frame cadence.

## Solution

Memoize output-config arrays by content (`client/camera/components/CameraView.tsx`
and `CameraView.ios.tsx`):

```typescript
const barcodeTypesKey = barcodeTypes.join(",");
const barcodeFormats = useMemo(
  () => mapBarcodeTypes(barcodeTypes),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content, not the array reference
  [barcodeTypesKey],
);
```

Read live state in the handler through a render-time ref mirror
(`client/screens/ScanScreen.tsx`):

```typescript
const scanPhaseRef = useRef(scanPhase);
scanPhaseRef.current = scanPhase; // render-time, NOT useEffect

const onBarcodeScanned = useCallback((result: BarcodeResult) => {
  const currentPhase = scanPhaseRef.current; // never the closed-over scanPhase
  // ... pure decision via evaluateBarcodeDetection(tracking, barcode)
}, [/* no phase dep */]);
```

Regression pins: a CameraView test asserts `barcodeFormats` is referentially
stable across content-equal rerenders, and a ScanScreen wiring test drives the
callback captured on the FIRST render to a full lock (fails against the
closure-reading code). React Compiler does not cover either fix — it also keys
on reference identity, and render-time ref writes are a compiler bailout that
stays load-bearing here.

## Prevention

- Any array/object prop feeding a VisionCamera `use*Output` hook must be
  referentially stable across content-equal renders — memoize by content key.
- Any state read inside a callback handed to a native camera output must go
  through a ref assigned at render time; never rely on the library re-attaching
  fresh closures, and never assume the iOS and Android output hooks share
  freshness semantics.
- When a camera screen "loses" phase-gated UI *and* detection together,
  suspect one camera-init/phase root cause before treating them as two bugs.

## Related Files

- `client/camera/components/CameraView.tsx` / `CameraView.ios.tsx` — content-keyed output memoization
- `client/screens/ScanScreen.tsx` — render-time `scanPhaseRef` mirror
- `client/screens/scan-screen-utils.ts` — `evaluateBarcodeDetection` (pure lock decision, unit-tested)
- `client/camera/components/__tests__/CameraView.test.tsx` / `client/screens/__tests__/ScanScreen.test.tsx` — the two regression pins

## See Also

- [Stale Closure in React Callbacks - Use Refs for Synchronous Checks](stale-closure-callback-refs.md) — the general React lesson; this file adds the native-attach-time and per-platform specifics
- [<Camera zoom={SharedValue}> prop throws and kills the whole preview without react-native-vision-camera-worklets](../runtime-errors/vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md) — sibling VisionCamera prop-semantics gotcha from the same overhaul
