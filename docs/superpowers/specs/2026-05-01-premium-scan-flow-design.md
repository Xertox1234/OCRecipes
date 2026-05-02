# Premium Scan Flow — Design Spec

**Date:** 2026-05-01
**Status:** Approved for implementation planning
**Branch target:** `feature/premium-scan-flow`

---

## Overview

Redesign the ScanScreen into a premium, unified capture session. Instead of navigating between screens during a scan, the user stays on one screen through all steps. The camera experience stages its reveals, tracks detection confidence visually, delivers a choreographed lock moment, and progresses through up to three optional steps via a persistent step pill and morphing reticle.

This redesign covers two distinct flows that share the same screen shell:

- **Packaged product flow** — barcode scan → optional nutrition label photo → optional front label photo
- **Smart photo flow** — shutter tap → AI classification → confirmation (prepared meals, restaurant menus)

---

## Scope

**In scope:**

- Full screen anatomy redesign (step pill, morphing reticle, coach hints, product chip)
- Premium arrival animation sequence
- Detection confidence visualised via bracket colour (white → amber → green)
- Lock moment choreography (snap, sonar ring, shutter flash, haptic chord)
- Step pill progression with animated state transitions
- Reticle morphing between barcode shape and nutrition label shape
- Smart photo flow with inline product chip (replaces ClassificationOverlay)
- Coach hint escalation ladder for both flows
- Confetti celebration on session complete

**Out of scope (future):**

- Auto-capture via frame processors (manual tap-to-capture retained for steps 2 and 3)
- `@shopify/react-native-skia` (all effects implemented with Reanimated 4 + react-native-svg)
- `react-native-fast-opencv` edge detection ghost

---

## Principles

1. **Stage reveals.** Nothing arrives all at once. Camera → brackets → step pill → coach line, each on a deliberate delay.
2. **Cross-fade, never pop.** Coach copy and state labels ease in/out (180ms out, 220ms in, overlapping).
3. **Colour before numbers.** Confidence is expressed as bracket warmth (white → amber → green), never as a percentage.
4. **Spring, don't tween.** Every position and scale change uses `withSpring`. Linear tweens only for opacity fades.
5. **Chord effects.** The lock moment fires motion + colour + particle + haptic within a 50ms window. The brain reads the cluster as a single real event.
6. **Morph, don't swap.** The reticle is one persistent SVG component that animates between states. It never unmounts.
7. **Be stingy with celebration.** One confetti burst at session complete. Nothing else.
8. **Trust the user.** Coach copy is one short phrase. No instructions about lighting or angle.

---

## Screen Anatomy

```
┌─────────────────────────────────┐
│  [safe area top]                │
│  ┌─────────────────────────┐    │
│  │ ● ─── ○ ─── ○           │    │  ← StepPill (floats, backdrop blur)
│  │ Barcode  Nutrition  Front│    │
│  └─────────────────────────┘    │
│                                 │
│         [camera viewfinder]     │
│                                 │
│         ┌──       ──┐           │
│         │   reticle │           │  ← ScanReticle (SVG, persists)
│         └──       ──┘           │
│                                 │
│      Point at a barcode         │  ← CoachHint
│                                 │
│  [⚡]      [ shutter ]    [🖼]   │  ← controls
│  [safe area bottom]             │
└─────────────────────────────────┘
```

The product chip slides up from the bottom on barcode lock, covering the controls but not the reticle or step pill.

---

## State Machine

### Packaged Product Path

```
IDLE
  └→ HUNTING
       ├→ BARCODE_TRACKING      (first detection, low confidence)
       │    ├→ HUNTING           (barcode leaves frame)
       │    └→ BARCODE_LOCKED    (high confidence, ≥0.85)
       │         ├→ SESSION_COMPLETE  ("Looks right" → navigate NutritionDetail)
       │         └→ STEP2_CAPTURING  ("Add nutrition photo")
       │              └→ STEP2_REVIEWING  (shutter tapped, OCR running)
       │                   └→ STEP2_CONFIRMED  (user confirms chip)
       │                        ├→ SESSION_COMPLETE  (skip step 3)
       │                        └→ STEP3_CAPTURING
       │                             └→ STEP3_REVIEWING
       │                                  └→ SESSION_COMPLETE
       └→ CLASSIFYING           (shutter tapped, no barcode — smart photo path)
```

### Smart Photo Path

```
HUNTING → CLASSIFYING
  ├→ SMART_CONFIRMED  (classification succeeded)
  │    └→ navigate PhotoAnalysis / MenuScanResult  (user confirms chip)
  └→ SMART_ERROR      (classification failed)
       └→ retry / fallback to manual PhotoIntent
```

All states are expressed as a single `scanPhase` discriminated union in `ScanScreen`. No parallel state flags.

```ts
type ScanPhase =
  | { type: "IDLE" }
  | { type: "HUNTING" }
  | {
      type: "BARCODE_TRACKING";
      barcode: string;
      bounds: BarcodeResult["bounds"];
    }
  | { type: "BARCODE_LOCKED"; barcode: string; product?: ProductSummary }
  | { type: "STEP2_CAPTURING"; barcode: string; product?: ProductSummary }
  | {
      type: "STEP2_REVIEWING";
      barcode: string;
      product?: ProductSummary;
      ocrText: string;
      imageUri: string;
    }
  | {
      type: "STEP2_CONFIRMED";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      ocrText: string;
    }
  | {
      type: "STEP3_CAPTURING";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      ocrText: string;
    }
  | {
      type: "STEP3_REVIEWING";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      ocrText: string;
      frontImageUri: string;
    }
  | {
      type: "SESSION_COMPLETE";
      barcode: string;
      nutritionImageUri?: string;
      frontImageUri?: string;
      ocrText?: string;
    }
  | { type: "CLASSIFYING"; imageUri: string }
  | {
      type: "SMART_CONFIRMED";
      imageUri: string;
      classification: PhotoClassification;
    }
  | { type: "SMART_ERROR"; imageUri: string; error: string };
```

---

## Component Architecture

### New Components (`client/camera/components/`)

#### `ScanReticle`

Single persistent SVG component. Four `<Path>` elements forming L-shaped corners. All position and dimension changes driven by Reanimated shared values:

- `reticleX`, `reticleY` — centre position (tracks barcode in TRACKING state)
- `reticleWidth`, `reticleHeight` — dimensions (morphs between barcode ~130×80 and label ~110×150)
- `cornerColor` — interpolated from white → amber → green via confidence value
- `cornerScale` — drives the lock snap (1 → 1.1 overshoot)

Corner detection: brackets teleport immediately to detected position on first detection, then spring-track subsequent positions. This is the "teleport then settle" behaviour — not a smooth slide.

Breathing animation: when `scanPhase === 'HUNTING'`, a slow `withRepeat` nudges `reticleWidth` ±4px at 0.4 Hz.

#### `StepPill`

Three-dot progress indicator, floated in the safe area. Each dot independently holds `idle | active | done` state.

- `idle` — faint border, low opacity label
- `active` — white border, pulsing ring (animated `withRepeat` border scale)
- `done` — green fill, checkmark icon, scale 1→1.25→1 spring on transition

A connector line between dots animates its tint from grey to green as the preceding step completes.

Hidden entirely when `scanPhase` enters the smart photo path (`CLASSIFYING`, `SMART_CONFIRMED`, `SMART_ERROR`).

#### `CoachHint`

Animated text component with a cross-fade queue. Accepts a `message` prop; when it changes, outgoing opacity fades to 0 over 180ms while incoming fades in over 220ms (overlapping — not sequential).

Escalation ladder for packaged product flow (timers reset on any detection event):

- 0s: "Point at a barcode"
- 5s: "Try moving closer"
- 10s: "Or tap ⚡ for torch"
- 15s: "Or tap to capture manually"

Escalation for smart photo waiting state:

- 0s: "Photograph your meal"
- 8s: "Try moving to better light"

#### `ProductChip`

Bottom sheet that slides up on barcode lock and between steps. Spring entry (`damping:18, stiffness:280`). Contains:

- Product image (thumbnail), brand name, product name
- Primary action: "Looks right →"
- Secondary action: "Add nutrition photo" (with small "Optional" badge) — only in BARCODE_LOCKED
- Tertiary link: "+ Add front photo" — only in BARCODE_LOCKED
- On STEP2_CONFIRMED: shows extracted nutrition summary, "Looks right" + "Edit values" (edit navigates to existing LabelAnalysis screen)
- On STEP3_REVIEWING: same pattern with "Edit values" navigating to FrontLabelConfirm

Smart photo variant: same visual shell, shows detected food type + confidence description (no step actions).

#### `ScanFlashOverlay`

Full-screen white `View`. Fires on barcode lock: opacity 0 → 0.4 → 0 over 80ms total. Simulates shutter. No interaction, no Skia required.

#### `ScanSonarRing`

Single SVG `<Circle>` centred on the locked barcode position. Fires once on lock:

- `r`: 1 → 80 over 400ms
- `opacity`: 1 → 0 over 400ms
- Stroke colour: `#22c55e` at 60% opacity
- Component unmounts after animation completes

### Refactored

#### `ScanScreen`

- Replace `isScanning` ref + `useScanClassification` FSM with a single `scanPhase` discriminated union (`useReducer`)
- Orchestrate all new components
- Timer management for coach hint escalation
- On `SESSION_COMPLETE`: navigate to `NutritionDetail` passing `{ barcode, nutritionImageUri?, frontLabelImageUri?, localOCRText? }`

#### `useCamera` hook

- Add `detectionConfidence` as a Reanimated shared value (0–1, normalised)
- VisionCamera v5's barcode scanner does not expose a raw confidence score — barcodes are detected or not per frame. Confidence is derived from **consecutive frame stability**: track how many successive frames have returned the same barcode value. Normalise: 0 frames = 0.0, 3 frames ≈ 0.5, 7+ frames = 1.0. Update the shared value on every callback so `ScanReticle` can drive colour interpolation on the UI thread without JS bridge round-trips.
- `BARCODE_TRACKING` → `BARCODE_LOCKED` transition fires when `detectionConfidence >= 0.85` (i.e., ~7 stable frames at 60fps ≈ 115ms, well under the 100ms perceptual threshold).

#### `ClassificationOverlay`

- Retired. Smart photo confirmation uses `ProductChip` instead.
- Only caller is `ScanScreen.tsx`, which is being refactored. Safe to delete.

### Preserved Unchanged

- `LabelAnalysis` screen — reached via "Edit values" in STEP2_REVIEWED
- `FrontLabelConfirm` screen — reached via "Edit values" in STEP3_REVIEWED
- `NutritionDetail` screen — primary destination after session complete
- `PhotoAnalysis`, `MenuScanResult` — destinations after smart photo confirmation
- `BatchScanScreen` — separate flow, unaffected

---

## Animation Timing Reference

| Moment                     | Animation                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| Camera preview fade-in     | opacity 0→1, 200ms, starts at 0ms                                                               |
| Bracket draw (staggered)   | each corner scale 0→1, `withSpring({damping:14, stiffness:180})`, 30ms stagger, starts at 150ms |
| Step pill fade-in          | opacity 0→1, starts at 350ms                                                                    |
| Coach hint fade-in         | opacity 0→1, starts at 500ms                                                                    |
| Bracket breathe            | `withRepeat(withSequence(+4px, -4px))`, 1s per cycle, active in HUNTING only                    |
| First detection — position | immediate set to barcode position, then spring-track                                            |
| Confidence colour          | `interpolateColor(confidence, [0, 0.5, 0.85], ['#fff', '#f59e0b', '#22c55e'])` — worklet        |
| Lock snap                  | `cornerScale` 1→1.1, `withSpring({damping:8})` — deliberate overshoot                           |
| Sonar ring                 | SVG `r` 1→80, opacity 1→0, 400ms, fires concurrently with snap                                  |
| Shutter flash              | opacity 0→0.4→0, 80ms total                                                                     |
| Lock haptic                | `Haptics.notificationAsync(Success)` — fires at 0ms with snap                                   |
| Product chip entry         | translateY +100%→0, `withSpring({damping:18, stiffness:280})`                                   |
| Step done transition       | dot scale 1→1.25→1, green fill, `withSpring({damping:10})`                                      |
| Reticle morph (step 2)     | width + height spring to new values, `withSpring({damping:16, stiffness:220})`                  |
| Session complete confetti  | ~30 pieces, 600ms duration, origin at top of success `ProductChip`                              |

---

## Coach Hint Copy

| State            | Message                                    |
| ---------------- | ------------------------------------------ |
| HUNTING 0s       | "Point at a barcode"                       |
| HUNTING 5s       | "Try moving closer"                        |
| HUNTING 10s      | "Or tap ⚡ for torch"                      |
| HUNTING 15s      | "Or tap to capture manually"               |
| BARCODE_TRACKING | "Hold steady…"                             |
| STEP2_CAPTURING  | "Frame the Nutrition Facts panel"          |
| STEP3_CAPTURING  | "Frame the front of the package"           |
| CLASSIFYING      | _(hidden — analysing badge shown instead)_ |
| SMART_PHOTO 0s   | "Photograph your meal"                     |
| SMART_PHOTO 8s   | "Try moving to better light"               |

---

## Accessibility

- `StepPill` announces step transitions via `AccessibilityInfo.announceForAccessibility()` (iOS) + `accessibilityLiveRegion="polite"` on Android
- `CoachHint` uses `accessibilityLiveRegion="polite"` so VoiceOver/TalkBack reads changes
- `ProductChip` receives focus when it slides up (`accessibilityViewIsModal` on the sheet container)
- Haptics always fire regardless of `reducedMotion`
- When `reducedMotion` is true: bracket breathe disabled, sonar ring disabled, shutter flash disabled, spring animations replaced with `withTiming` fades. Step transitions and product chip still animate (position changes, not decorative).
- Confetti disabled when `reducedMotion` is true

---

## Navigation Contract

`SESSION_COMPLETE` always navigates to `NutritionDetail` with:

```ts
{
  barcode: string
  nutritionImageUri?: string   // captured in step 2
  frontLabelImageUri?: string  // captured in step 3
  localOCRText?: string        // from MLKit on step 2 capture
}
```

`NutritionDetail` already accepts `barcode`. The optional fields are additive — existing behaviour unchanged when they are absent.

Smart photo flows navigate to their existing destination screens unchanged:

- Meal photo → `PhotoAnalysis`
- Menu photo → `MenuScanResult`

---

## Files Affected

**New:**

- `client/camera/components/ScanReticle.tsx`
- `client/camera/components/StepPill.tsx`
- `client/camera/components/CoachHint.tsx`
- `client/camera/components/ProductChip.tsx`
- `client/camera/components/ScanFlashOverlay.tsx`
- `client/camera/components/ScanSonarRing.tsx`

**Refactored:**

- `client/screens/ScanScreen.tsx`
- `client/camera/hooks/useCamera.ts`

**Deleted:**

- `client/components/ClassificationOverlay.tsx`

**Preserved unchanged:**

- `client/screens/LabelAnalysis*`
- `client/screens/FrontLabelConfirm*`
- `client/screens/NutritionDetail*`
- `client/screens/PhotoAnalysis*`
- `client/screens/MenuScanResult*`
- `client/screens/BatchScanScreen.tsx`
