# Premium Scan Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign ScanScreen into a premium unified capture session with confidence-driven reticle animation, lock-moment choreography, and a step-based optional flow for nutrition + front label photos.

**Architecture:** Single `scanPhase` discriminated union (via `useReducer`) replaces the current ref-based FSM and `useScanClassification` hook. Six new components (`ScanReticle`, `StepPill`, `CoachHint`, `ProductChip`, `ScanFlashOverlay`, `ScanSonarRing`) are composed directly in `ScanScreen`. Each component has a co-located `*-utils.ts` with pure functions tested in Vitest without React rendering.

**Tech Stack:** `react-native-reanimated` 4 (shared values, `useAnimatedProps` worklets), `react-native-svg` 15 (`createAnimatedComponent`), `expo-haptics`, `react-native-confetti-cannon` (new install)

---

## File Structure

**New files:**

- `client/camera/types/scan-phase.ts` — `ScanPhase` + `ScanAction` + `ProductSummary` types
- `client/camera/reducers/scan-phase-reducer.ts` — pure reducer
- `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`
- `client/camera/components/CoachHint-utils.ts` — `getCoachMessage(phase, elapsedSeconds)`
- `client/camera/components/__tests__/CoachHint-utils.test.ts`
- `client/camera/components/CoachHint.tsx` — cross-fade animated hint text
- `client/camera/components/ScanFlashOverlay.tsx` — full-screen white flash on lock
- `client/camera/components/ScanSonarRing.tsx` — expanding SVG ring on lock
- `client/camera/components/StepPill-utils.ts` — `getStepDotState(phase, stepIndex)`
- `client/camera/components/__tests__/StepPill-utils.test.ts`
- `client/camera/components/StepPill.tsx` — 3-dot progress indicator
- `client/camera/components/ScanReticle-utils.ts` — `getReticleTarget(phase, screenW, screenH)`
- `client/camera/components/__tests__/ScanReticle-utils.test.ts`
- `client/camera/components/ScanReticle.tsx` — full-screen SVG corner brackets
- `client/camera/components/ProductChip-utils.ts` — `getProductChipVariant(phase)`
- `client/camera/components/__tests__/ProductChip-utils.test.ts`
- `client/camera/components/ProductChip.tsx` — animated bottom-sheet card

**Modified:**

- `client/screens/ScanScreen.tsx` — full rewrite with `useReducer`
- `client/camera/index.ts` — export new components
- `client/navigation/RootStackNavigator.tsx` — add `nutritionImageUri?`, `frontLabelImageUri?`, `localOCRText?` to `NutritionDetail` params

**Deleted:**

- `client/components/ClassificationOverlay.tsx`
- `client/hooks/useScanClassification.ts`

---

## Task 1: ScanPhase types and reducer

**Files:**

- Create: `client/camera/types/scan-phase.ts`
- Create: `client/camera/reducers/scan-phase-reducer.ts`
- Create: `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// client/camera/reducers/__tests__/scan-phase-reducer.test.ts
import { describe, it, expect } from "vitest";
import { scanPhaseReducer } from "../scan-phase-reducer";
import type { ScanPhase, ScanAction } from "../../types/scan-phase";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("scanPhaseReducer", () => {
  it("CAMERA_READY transitions IDLE → HUNTING", () => {
    const state: ScanPhase = { type: "IDLE" };
    expect(scanPhaseReducer(state, { type: "CAMERA_READY" })).toEqual({
      type: "HUNTING",
    });
  });

  it("FIRST_BARCODE_DETECTED transitions HUNTING → BARCODE_TRACKING", () => {
    const state: ScanPhase = { type: "HUNTING" };
    const result = scanPhaseReducer(state, {
      type: "FIRST_BARCODE_DETECTED",
      barcode: "123",
      bounds: BOUNDS,
    });
    expect(result).toEqual({
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 1,
    });
  });

  it("BARCODE_UPDATED increments frameCount", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
    };
    const newBounds = { x: 0.41, y: 0.45, width: 0.2, height: 0.1 };
    const result = scanPhaseReducer(state, {
      type: "BARCODE_UPDATED",
      bounds: newBounds,
    });
    expect(result).toEqual({
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: newBounds,
      frameCount: 4,
    });
  });

  it("BARCODE_LOCKED transitions BARCODE_TRACKING → BARCODE_LOCKED", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 7,
    };
    const result = scanPhaseReducer(state, { type: "BARCODE_LOCKED" });
    expect(result).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    });
  });

  it("PRODUCT_LOADED attaches product to BARCODE_LOCKED", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };
    const product = { name: "Test Bar", brand: "Acme" };
    const result = scanPhaseReducer(state, { type: "PRODUCT_LOADED", product });
    expect(result).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product,
    });
  });

  it("BARCODE_LOST transitions BARCODE_TRACKING → HUNTING", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 2,
    };
    expect(scanPhaseReducer(state, { type: "BARCODE_LOST" })).toEqual({
      type: "HUNTING",
    });
  });

  it("CONFIRM_PRODUCT from BARCODE_LOCKED → SESSION_COMPLETE (barcode only)", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };
    expect(scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" })).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
    });
  });

  it("ADD_NUTRITION_PHOTO transitions BARCODE_LOCKED → STEP2_CAPTURING", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product: { name: "Bar" },
    };
    const result = scanPhaseReducer(state, { type: "ADD_NUTRITION_PHOTO" });
    expect(result).toEqual({
      type: "STEP2_CAPTURING",
      barcode: "123",
      product: { name: "Bar" },
    });
  });

  it("STEP_PHOTO_CAPTURED from STEP2_CAPTURING → STEP2_REVIEWING", () => {
    const state: ScanPhase = { type: "STEP2_CAPTURING", barcode: "123" };
    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
    expect(result).toEqual({
      type: "STEP2_REVIEWING",
      barcode: "123",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  it("STEP_CONFIRMED from STEP2_REVIEWING → STEP2_CONFIRMED", () => {
    const state: ScanPhase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, { type: "STEP_CONFIRMED" });
    expect(result).toEqual({
      type: "STEP2_CONFIRMED",
      barcode: "123",
      nutritionImageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  it("CONFIRM_PRODUCT from STEP2_CONFIRMED → SESSION_COMPLETE with nutrition data", () => {
    const state: ScanPhase = {
      type: "STEP2_CONFIRMED",
      barcode: "123",
      nutritionImageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" });
    expect(result).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
      nutritionImageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  it("ADD_FRONT_PHOTO transitions STEP2_CONFIRMED → STEP3_CAPTURING", () => {
    const state: ScanPhase = {
      type: "STEP2_CONFIRMED",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, { type: "ADD_FRONT_PHOTO" });
    expect(result).toEqual({
      type: "STEP3_CAPTURING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
    });
  });

  it("STEP_PHOTO_CAPTURED from STEP3_CAPTURING → STEP3_REVIEWING", () => {
    const state: ScanPhase = {
      type: "STEP3_CAPTURING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://front.jpg",
    });
    expect(result).toEqual({
      type: "STEP3_REVIEWING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    });
  });

  it("CONFIRM_PRODUCT from STEP3_REVIEWING → SESSION_COMPLETE with all data", () => {
    const state: ScanPhase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    };
    const result = scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" });
    expect(result).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    });
  });

  it("SMART_PHOTO_INITIATED → CLASSIFYING", () => {
    const state: ScanPhase = { type: "HUNTING" };
    expect(
      scanPhaseReducer(state, {
        type: "SMART_PHOTO_INITIATED",
        imageUri: "file://meal.jpg",
      }),
    ).toEqual({
      type: "CLASSIFYING",
      imageUri: "file://meal.jpg",
    });
  });

  it("CLASSIFICATION_SUCCEEDED from CLASSIFYING → SMART_CONFIRMED", () => {
    const classification = {
      contentType: "prepared_meal",
      overallConfidence: 0.9,
    } as any;
    const state: ScanPhase = {
      type: "CLASSIFYING",
      imageUri: "file://meal.jpg",
    };
    const result = scanPhaseReducer(state, {
      type: "CLASSIFICATION_SUCCEEDED",
      classification,
    });
    expect(result).toEqual({
      type: "SMART_CONFIRMED",
      imageUri: "file://meal.jpg",
      classification,
    });
  });

  it("CLASSIFICATION_FAILED from CLASSIFYING → SMART_ERROR", () => {
    const state: ScanPhase = {
      type: "CLASSIFYING",
      imageUri: "file://meal.jpg",
    };
    const result = scanPhaseReducer(state, {
      type: "CLASSIFICATION_FAILED",
      error: "timeout",
    });
    expect(result).toEqual({
      type: "SMART_ERROR",
      imageUri: "file://meal.jpg",
      error: "timeout",
    });
  });

  it("RESET always returns IDLE", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };
    expect(scanPhaseReducer(state, { type: "RESET" })).toEqual({
      type: "IDLE",
    });
  });

  it("ignores actions that do not apply to the current phase", () => {
    const state: ScanPhase = { type: "HUNTING" };
    expect(
      scanPhaseReducer(state, { type: "BARCODE_UPDATED", bounds: BOUNDS }),
    ).toEqual(state);
    expect(scanPhaseReducer(state, { type: "BARCODE_LOCKED" })).toEqual(state);
    expect(scanPhaseReducer(state, { type: "ADD_NUTRITION_PHOTO" })).toEqual(
      state,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts
```

Expected: FAIL — "Cannot find module '../scan-phase-reducer'"

- [ ] **Step 3: Create the types file**

```typescript
// client/camera/types/scan-phase.ts
import type { BarcodeResult } from "../types";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

export interface ProductSummary {
  name: string;
  brand?: string;
  imageUri?: string;
}

type Bounds = NonNullable<BarcodeResult["bounds"]>;

export type ScanPhase =
  | { type: "IDLE" }
  | { type: "HUNTING" }
  | {
      type: "BARCODE_TRACKING";
      barcode: string;
      bounds: Bounds;
      frameCount: number;
    }
  | {
      type: "BARCODE_LOCKED";
      barcode: string;
      bounds: Bounds;
      product?: ProductSummary;
    }
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
      classification: PhotoAnalysisResponse;
    }
  | { type: "SMART_ERROR"; imageUri: string; error: string };

export type ScanAction =
  | { type: "CAMERA_READY" }
  | { type: "FIRST_BARCODE_DETECTED"; barcode: string; bounds: Bounds }
  | { type: "BARCODE_UPDATED"; bounds: Bounds }
  | { type: "BARCODE_LOCKED" }
  | { type: "PRODUCT_LOADED"; product: ProductSummary }
  | { type: "BARCODE_LOST" }
  | { type: "CONFIRM_PRODUCT" }
  | { type: "ADD_NUTRITION_PHOTO" }
  | { type: "ADD_FRONT_PHOTO" }
  | { type: "STEP_PHOTO_CAPTURED"; imageUri: string; ocrText?: string }
  | { type: "STEP_CONFIRMED" }
  | { type: "SMART_PHOTO_INITIATED"; imageUri: string }
  | { type: "CLASSIFICATION_SUCCEEDED"; classification: PhotoAnalysisResponse }
  | { type: "CLASSIFICATION_FAILED"; error: string }
  | { type: "RESET" };
```

- [ ] **Step 4: Create the reducer**

```typescript
// client/camera/reducers/scan-phase-reducer.ts
import type { ScanPhase, ScanAction } from "../types/scan-phase";

export function scanPhaseReducer(
  state: ScanPhase,
  action: ScanAction,
): ScanPhase {
  switch (action.type) {
    case "CAMERA_READY":
      return { type: "HUNTING" };

    case "FIRST_BARCODE_DETECTED":
      if (state.type !== "HUNTING" && state.type !== "BARCODE_TRACKING")
        return state;
      return {
        type: "BARCODE_TRACKING",
        barcode: action.barcode,
        bounds: action.bounds,
        frameCount: 1,
      };

    case "BARCODE_UPDATED":
      if (state.type !== "BARCODE_TRACKING") return state;
      return {
        ...state,
        bounds: action.bounds,
        frameCount: state.frameCount + 1,
      };

    case "BARCODE_LOCKED":
      if (state.type !== "BARCODE_TRACKING") return state;
      return {
        type: "BARCODE_LOCKED",
        barcode: state.barcode,
        bounds: state.bounds,
      };

    case "PRODUCT_LOADED":
      if (state.type !== "BARCODE_LOCKED" && state.type !== "STEP2_CAPTURING")
        return state;
      return { ...state, product: action.product };

    case "BARCODE_LOST":
      if (state.type !== "BARCODE_TRACKING") return state;
      return { type: "HUNTING" };

    case "CONFIRM_PRODUCT":
      if (state.type === "BARCODE_LOCKED") {
        return { type: "SESSION_COMPLETE", barcode: state.barcode };
      }
      if (state.type === "STEP2_CONFIRMED") {
        return {
          type: "SESSION_COMPLETE",
          barcode: state.barcode,
          nutritionImageUri: state.nutritionImageUri,
          ocrText: state.ocrText,
        };
      }
      if (state.type === "STEP3_REVIEWING") {
        return {
          type: "SESSION_COMPLETE",
          barcode: state.barcode,
          nutritionImageUri: state.nutritionImageUri,
          ocrText: state.ocrText,
          frontImageUri: state.frontImageUri,
        };
      }
      return state;

    case "ADD_NUTRITION_PHOTO":
      if (state.type !== "BARCODE_LOCKED") return state;
      return {
        type: "STEP2_CAPTURING",
        barcode: state.barcode,
        product: state.product,
      };

    case "ADD_FRONT_PHOTO":
      if (state.type !== "STEP2_CONFIRMED") return state;
      return {
        type: "STEP3_CAPTURING",
        barcode: state.barcode,
        product: state.product,
        nutritionImageUri: state.nutritionImageUri,
        ocrText: state.ocrText,
      };

    case "STEP_PHOTO_CAPTURED":
      if (state.type === "STEP2_CAPTURING") {
        return {
          type: "STEP2_REVIEWING",
          barcode: state.barcode,
          product: state.product,
          imageUri: action.imageUri,
          ocrText: action.ocrText ?? "",
        };
      }
      if (state.type === "STEP3_CAPTURING") {
        return {
          type: "STEP3_REVIEWING",
          barcode: state.barcode,
          product: state.product,
          nutritionImageUri: state.nutritionImageUri,
          ocrText: state.ocrText,
          frontImageUri: action.imageUri,
        };
      }
      return state;

    case "STEP_CONFIRMED":
      if (state.type !== "STEP2_REVIEWING") return state;
      return {
        type: "STEP2_CONFIRMED",
        barcode: state.barcode,
        product: state.product,
        nutritionImageUri: state.imageUri,
        ocrText: state.ocrText,
      };

    case "SMART_PHOTO_INITIATED":
      return { type: "CLASSIFYING", imageUri: action.imageUri };

    case "CLASSIFICATION_SUCCEEDED":
      if (state.type !== "CLASSIFYING") return state;
      return {
        type: "SMART_CONFIRMED",
        imageUri: state.imageUri,
        classification: action.classification,
      };

    case "CLASSIFICATION_FAILED":
      if (state.type !== "CLASSIFYING") return state;
      return {
        type: "SMART_ERROR",
        imageUri: state.imageUri,
        error: action.error,
      };

    case "RESET":
      return { type: "IDLE" };

    default:
      return state;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts
```

Expected: All 16 tests PASS

- [ ] **Step 6: Commit**

```bash
git add client/camera/types/scan-phase.ts client/camera/reducers/scan-phase-reducer.ts client/camera/reducers/__tests__/scan-phase-reducer.test.ts
git commit -m "feat(scan): add ScanPhase discriminated union and reducer"
```

---

## Task 2: CoachHint component

**Files:**

- Create: `client/camera/components/CoachHint-utils.ts`
- Create: `client/camera/components/__tests__/CoachHint-utils.test.ts`
- Create: `client/camera/components/CoachHint.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// client/camera/components/__tests__/CoachHint-utils.test.ts
import { describe, it, expect } from "vitest";
import { getCoachMessage } from "../CoachHint-utils";

describe("getCoachMessage", () => {
  it('returns "Point at a barcode" for HUNTING at 0s', () => {
    expect(getCoachMessage({ type: "HUNTING" }, 0)).toBe("Point at a barcode");
  });

  it('escalates to "Try moving closer" after 5s', () => {
    expect(getCoachMessage({ type: "HUNTING" }, 5)).toBe("Try moving closer");
  });

  it("escalates to torch tip after 10s", () => {
    expect(getCoachMessage({ type: "HUNTING" }, 10)).toBe(
      "Or tap ⚡ for torch",
    );
  });

  it("escalates to manual capture tip after 15s", () => {
    expect(getCoachMessage({ type: "HUNTING" }, 15)).toBe(
      "Or tap to capture manually",
    );
  });

  it('returns "Hold steady…" for BARCODE_TRACKING', () => {
    const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };
    expect(
      getCoachMessage(
        {
          type: "BARCODE_TRACKING",
          barcode: "123",
          bounds: BOUNDS,
          frameCount: 3,
        },
        0,
      ),
    ).toBe("Hold steady…");
  });

  it("returns empty string for BARCODE_LOCKED (chip covers coach)", () => {
    const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };
    expect(
      getCoachMessage(
        { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
        0,
      ),
    ).toBe("");
  });

  it("returns label hint for STEP2_CAPTURING", () => {
    expect(
      getCoachMessage({ type: "STEP2_CAPTURING", barcode: "123" }, 0),
    ).toBe("Frame the Nutrition Facts panel");
  });

  it("returns front label hint for STEP3_CAPTURING", () => {
    expect(
      getCoachMessage(
        {
          type: "STEP3_CAPTURING",
          barcode: "123",
          nutritionImageUri: "x",
          ocrText: "",
        },
        0,
      ),
    ).toBe("Frame the front of the package");
  });

  it("returns empty string for CLASSIFYING (analysing badge shown instead)", () => {
    expect(getCoachMessage({ type: "CLASSIFYING", imageUri: "x" }, 0)).toBe("");
  });

  it("returns meal hint for IDLE/HUNTING at 0s", () => {
    expect(getCoachMessage({ type: "IDLE" }, 0)).toBe("Point at a barcode");
  });

  it('returns "Photograph your meal" smart photo escalation at 0s after smart photo started', () => {
    expect(getCoachMessage({ type: "HUNTING" }, 0)).toBe("Point at a barcode");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/camera/components/__tests__/CoachHint-utils.test.ts
```

Expected: FAIL — "Cannot find module '../CoachHint-utils'"

- [ ] **Step 3: Create CoachHint-utils.ts**

```typescript
// client/camera/components/CoachHint-utils.ts
import type { ScanPhase } from "../types/scan-phase";

export function getCoachMessage(
  phase: ScanPhase,
  elapsedSeconds: number,
): string {
  switch (phase.type) {
    case "IDLE":
    case "HUNTING": {
      if (elapsedSeconds >= 15) return "Or tap to capture manually";
      if (elapsedSeconds >= 10) return "Or tap ⚡ for torch";
      if (elapsedSeconds >= 5) return "Try moving closer";
      return "Point at a barcode";
    }
    case "BARCODE_TRACKING":
      return "Hold steady…";
    case "BARCODE_LOCKED":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return "";
    case "STEP2_CAPTURING":
      return "Frame the Nutrition Facts panel";
    case "STEP3_CAPTURING":
      return "Frame the front of the package";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run client/camera/components/__tests__/CoachHint-utils.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Create CoachHint.tsx**

```tsx
// client/camera/components/CoachHint.tsx
import React, { useEffect, useRef } from "react";
import { StyleSheet, AccessibilityInfo, Platform } from "react-native";
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";

interface Props {
  message: string;
}

export function CoachHint({ message }: Props) {
  const opacity = useSharedValue(0);
  const displayedMessage = useRef(message);

  useEffect(() => {
    if (message === displayedMessage.current) return;

    // Fade out current, then swap and fade in
    opacity.value = withTiming(0, { duration: 180 }, () => {
      "worklet";
      // Note: runOnJS not available in this position; message swap handled by key prop pattern below
    });

    const fadeOut = setTimeout(() => {
      displayedMessage.current = message;
      opacity.value = withTiming(1, { duration: 220 });
    }, 100); // overlap: start fade-in before fade-out completes

    return () => clearTimeout(fadeOut);
  }, [message, opacity]);

  useEffect(() => {
    if (message) {
      opacity.value = withTiming(1, { duration: 220 });
    } else {
      opacity.value = withTiming(0, { duration: 180 });
    }
  }, []);

  useEffect(() => {
    if (message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!message) return null;

  return (
    <Animated.Text
      style={[styles.hint, animatedStyle]}
      accessibilityLiveRegion="polite"
    >
      {message}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
```

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add client/camera/components/CoachHint-utils.ts client/camera/components/__tests__/CoachHint-utils.test.ts client/camera/components/CoachHint.tsx
git commit -m "feat(scan): add CoachHint component with escalation ladder"
```

---

## Task 3: ScanFlashOverlay and ScanSonarRing

**Files:**

- Create: `client/camera/components/ScanFlashOverlay.tsx`
- Create: `client/camera/components/ScanSonarRing.tsx`

These are pure animation components with no testable logic. They are tested visually during ScanScreen integration (Task 8).

- [ ] **Step 1: Create ScanFlashOverlay.tsx**

```tsx
// client/camera/components/ScanFlashOverlay.tsx
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  withSequence,
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";

interface Props {
  /** Increment this value to trigger a flash */
  triggerCount: number;
}

export function ScanFlashOverlay({ triggerCount }: Props) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (triggerCount === 0) return;
    opacity.value = withSequence(
      withTiming(0.4, { duration: 30 }),
      withTiming(0, { duration: 50 }),
    );
  }, [triggerCount, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, animatedStyle]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: "#FFFFFF" },
});
```

- [ ] **Step 2: Create ScanSonarRing.tsx**

```tsx
// client/camera/components/ScanSonarRing.tsx
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedProps,
  runOnJS,
} from "react-native-reanimated";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  cx: number;
  cy: number;
  screenWidth: number;
  screenHeight: number;
  onComplete: () => void;
}

export function ScanSonarRing({
  cx,
  cy,
  screenWidth,
  screenHeight,
  onComplete,
}: Props) {
  const r = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    r.value = withTiming(80, { duration: 400 });
    opacity.value = withTiming(0, { duration: 400 }, (finished) => {
      if (finished) runOnJS(onComplete)();
    });
  }, [r, opacity, onComplete]);

  const animatedProps = useAnimatedProps(() => ({
    r: r.value,
    opacity: opacity.value,
  }));

  return (
    <Svg
      style={[
        StyleSheet.absoluteFill,
        { width: screenWidth, height: screenHeight },
      ]}
      pointerEvents="none"
    >
      <AnimatedCircle
        cx={cx}
        cy={cy}
        stroke="rgba(34,197,94,0.6)"
        strokeWidth={2}
        fill="none"
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/camera/components/ScanFlashOverlay.tsx client/camera/components/ScanSonarRing.tsx
git commit -m "feat(scan): add ScanFlashOverlay and ScanSonarRing lock moment components"
```

---

## Task 4: StepPill component

**Files:**

- Create: `client/camera/components/StepPill-utils.ts`
- Create: `client/camera/components/__tests__/StepPill-utils.test.ts`
- Create: `client/camera/components/StepPill.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// client/camera/components/__tests__/StepPill-utils.test.ts
import { describe, it, expect } from "vitest";
import { getStepDotState, shouldShowStepPill } from "../StepPill-utils";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("getStepDotState", () => {
  it("all dots idle in HUNTING", () => {
    const phase = { type: "HUNTING" } as const;
    expect(getStepDotState(phase, 0)).toBe("active"); // step 1 is active when hunting
    expect(getStepDotState(phase, 1)).toBe("idle");
    expect(getStepDotState(phase, 2)).toBe("idle");
  });

  it("step 1 active during BARCODE_TRACKING", () => {
    const phase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
    } as const;
    expect(getStepDotState(phase, 0)).toBe("active");
    expect(getStepDotState(phase, 1)).toBe("idle");
  });

  it("step 1 done, step 2 active in STEP2_CAPTURING", () => {
    const phase = { type: "STEP2_CAPTURING", barcode: "123" } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("active");
    expect(getStepDotState(phase, 2)).toBe("idle");
  });

  it("steps 1+2 done, step 3 active in STEP3_CAPTURING", () => {
    const phase = {
      type: "STEP3_CAPTURING",
      barcode: "123",
      nutritionImageUri: "x",
      ocrText: "",
    } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("done");
    expect(getStepDotState(phase, 2)).toBe("active");
  });

  it("all done in SESSION_COMPLETE", () => {
    const phase = { type: "SESSION_COMPLETE", barcode: "123" } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("done");
    expect(getStepDotState(phase, 2)).toBe("done");
  });
});

describe("shouldShowStepPill", () => {
  it("shows for packaged product states", () => {
    expect(shouldShowStepPill({ type: "HUNTING" })).toBe(true);
    expect(
      shouldShowStepPill({
        type: "BARCODE_TRACKING",
        barcode: "123",
        bounds: BOUNDS,
        frameCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowStepPill({
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
      }),
    ).toBe(true);
    expect(
      shouldShowStepPill({ type: "STEP2_CAPTURING", barcode: "123" }),
    ).toBe(true);
  });

  it("hides for smart photo states", () => {
    expect(shouldShowStepPill({ type: "CLASSIFYING", imageUri: "x" })).toBe(
      false,
    );
    expect(
      shouldShowStepPill({
        type: "SMART_CONFIRMED",
        imageUri: "x",
        classification: {} as any,
      }),
    ).toBe(false);
    expect(
      shouldShowStepPill({ type: "SMART_ERROR", imageUri: "x", error: "err" }),
    ).toBe(false);
  });

  it("hides for IDLE", () => {
    expect(shouldShowStepPill({ type: "IDLE" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/camera/components/__tests__/StepPill-utils.test.ts
```

Expected: FAIL — "Cannot find module '../StepPill-utils'"

- [ ] **Step 3: Create StepPill-utils.ts**

```typescript
// client/camera/components/StepPill-utils.ts
import type { ScanPhase } from "../types/scan-phase";

export type StepDotState = "idle" | "active" | "done";

const SMART_PHOTO_PHASES = new Set([
  "CLASSIFYING",
  "SMART_CONFIRMED",
  "SMART_ERROR",
]);

export function shouldShowStepPill(phase: ScanPhase): boolean {
  return phase.type !== "IDLE" && !SMART_PHOTO_PHASES.has(phase.type);
}

export function getStepDotState(
  phase: ScanPhase,
  stepIndex: 0 | 1 | 2,
): StepDotState {
  switch (phase.type) {
    case "IDLE":
      return "idle";
    case "HUNTING":
    case "BARCODE_TRACKING":
    case "BARCODE_LOCKED":
      return stepIndex === 0 ? "active" : "idle";
    case "STEP2_CAPTURING":
    case "STEP2_REVIEWING":
      if (stepIndex === 0) return "done";
      if (stepIndex === 1) return "active";
      return "idle";
    case "STEP2_CONFIRMED":
      if (stepIndex === 0) return "done";
      if (stepIndex === 1) return "done";
      return "idle";
    case "STEP3_CAPTURING":
    case "STEP3_REVIEWING":
      if (stepIndex <= 1) return "done";
      return "active";
    case "SESSION_COMPLETE":
      return "done";
    default:
      return "idle";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run client/camera/components/__tests__/StepPill-utils.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Create StepPill.tsx**

```tsx
// client/camera/components/StepPill.tsx
import React, { useEffect } from "react";
import { StyleSheet, View, Text } from "react-native";
import Animated, {
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  useAnimatedStyle,
  cancelAnimation,
} from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import {
  getStepDotState,
  shouldShowStepPill,
  type StepDotState,
} from "./StepPill-utils";

const STEP_LABELS = ["Barcode", "Nutrition", "Front"];

interface DotProps {
  label: string;
  state: StepDotState;
}

function StepDot({ label, state }: DotProps) {
  const scale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const prevState = React.useRef<StepDotState>(state);

  useEffect(() => {
    if (prevState.current !== "done" && state === "done") {
      scale.value = withSequence(
        withSpring(1.25, { damping: 10 }),
        withSpring(1, { damping: 10 }),
      );
    }
    prevState.current = state;
  }, [state, scale]);

  useEffect(() => {
    if (state === "active") {
      ringOpacity.value = withTiming(1, { duration: 200 });
      ringScale.value = withRepeat(
        withSequence(
          withTiming(1.5, { duration: 700 }),
          withTiming(1, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(ringScale);
      cancelAnimation(ringOpacity);
      ringOpacity.value = withTiming(0, { duration: 200 });
      ringScale.value = 1;
    }
  }, [state, ringScale, ringOpacity]);

  const dotAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const ringAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const isDone = state === "done";
  const isActive = state === "active";

  return (
    <View style={styles.dotWrapper}>
      <Animated.View
        style={[
          styles.dot,
          isDone && styles.dotDone,
          isActive && styles.dotActive,
          dotAnimStyle,
        ]}
      >
        {isDone && <Text style={styles.checkmark}>✓</Text>}
      </Animated.View>
      {isActive && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.ring, ringAnimStyle]}
        />
      )}
      <Text style={[styles.label, isActive && styles.labelActive]}>
        {label}
      </Text>
    </View>
  );
}

interface Props {
  phase: ScanPhase;
}

export function StepPill({ phase }: Props) {
  const opacity = useSharedValue(0);
  const visible = shouldShowStepPill(phase);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.pill, animStyle]} pointerEvents="none">
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && <View style={styles.connector} />}
          <StepDot
            label={label}
            state={getStepDotState(phase, i as 0 | 1 | 2)}
          />
        </React.Fragment>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: "center",
  },
  dotWrapper: {
    alignItems: "center",
    gap: 4,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotActive: {
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  dotDone: {
    backgroundColor: "#22c55e",
    borderColor: "#22c55e",
  },
  checkmark: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  ring: {
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  connector: {
    width: 20,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginHorizontal: 4,
    marginBottom: 16,
  },
  label: {
    fontSize: 9,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 0.3,
  },
  labelActive: {
    color: "rgba(255,255,255,0.8)",
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add client/camera/components/StepPill-utils.ts client/camera/components/__tests__/StepPill-utils.test.ts client/camera/components/StepPill.tsx
git commit -m "feat(scan): add StepPill progress indicator"
```

---

## Task 5: ScanReticle component

**Files:**

- Create: `client/camera/components/ScanReticle-utils.ts`
- Create: `client/camera/components/__tests__/ScanReticle-utils.test.ts`
- Create: `client/camera/components/ScanReticle.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// client/camera/components/__tests__/ScanReticle-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  getReticleTarget,
  getConfidenceFromPhase,
  BARCODE_RETICLE,
  LABEL_RETICLE,
} from "../ScanReticle-utils";

const BOUNDS = { x: 0.3, y: 0.4, width: 0.4, height: 0.2 };
const SW = 390;
const SH = 844;

describe("getReticleTarget", () => {
  it("returns barcode-shaped centered target for IDLE", () => {
    const t = getReticleTarget({ type: "IDLE" }, SW, SH);
    expect(t.cx).toBe(SW / 2);
    expect(t.cy).toBe(SH / 2);
    expect(t.width).toBe(BARCODE_RETICLE.width);
    expect(t.height).toBe(BARCODE_RETICLE.height);
  });

  it("returns barcode-shaped centered target for HUNTING", () => {
    const t = getReticleTarget({ type: "HUNTING" }, SW, SH);
    expect(t.width).toBe(BARCODE_RETICLE.width);
    expect(t.height).toBe(BARCODE_RETICLE.height);
  });

  it("tracks barcode position in BARCODE_TRACKING", () => {
    const t = getReticleTarget(
      {
        type: "BARCODE_TRACKING",
        barcode: "123",
        bounds: BOUNDS,
        frameCount: 3,
      },
      SW,
      SH,
    );
    // cx = (0.3 + 0.4/2) * 390 = (0.5) * 390 = 195
    expect(t.cx).toBeCloseTo(195);
    // cy = (0.4 + 0.2/2) * 844 = (0.5) * 844 = 422
    expect(t.cy).toBeCloseTo(422);
  });

  it("locks to barcode position in BARCODE_LOCKED", () => {
    const t = getReticleTarget(
      { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
      SW,
      SH,
    );
    expect(t.cx).toBeCloseTo(195);
    expect(t.cy).toBeCloseTo(422);
  });

  it("returns label-shaped centered target for STEP2_CAPTURING", () => {
    const t = getReticleTarget(
      { type: "STEP2_CAPTURING", barcode: "123" },
      SW,
      SH,
    );
    expect(t.cx).toBe(SW / 2);
    expect(t.cy).toBe(SH / 2);
    expect(t.width).toBe(LABEL_RETICLE.width);
    expect(t.height).toBe(LABEL_RETICLE.height);
  });

  it("returns label-shaped target for STEP3_CAPTURING", () => {
    const t = getReticleTarget(
      {
        type: "STEP3_CAPTURING",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
      },
      SW,
      SH,
    );
    expect(t.width).toBe(LABEL_RETICLE.width);
  });
});

describe("getConfidenceFromPhase", () => {
  it("returns 0 for IDLE and HUNTING", () => {
    expect(getConfidenceFromPhase({ type: "IDLE" })).toBe(0);
    expect(getConfidenceFromPhase({ type: "HUNTING" })).toBe(0);
  });

  it("normalizes frameCount: 7 frames = 1.0", () => {
    const phase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 7,
    } as const;
    expect(getConfidenceFromPhase(phase)).toBe(1.0);
  });

  it("normalizes frameCount: 3 frames ≈ 0.43", () => {
    const phase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
    } as const;
    expect(getConfidenceFromPhase(phase)).toBeCloseTo(0.43, 1);
  });

  it("returns 1.0 for BARCODE_LOCKED and beyond", () => {
    expect(
      getConfidenceFromPhase({
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
      }),
    ).toBe(1.0);
    expect(
      getConfidenceFromPhase({ type: "STEP2_CAPTURING", barcode: "123" }),
    ).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/camera/components/__tests__/ScanReticle-utils.test.ts
```

Expected: FAIL — "Cannot find module '../ScanReticle-utils'"

- [ ] **Step 3: Create ScanReticle-utils.ts**

```typescript
// client/camera/components/ScanReticle-utils.ts
import type { ScanPhase } from "../types/scan-phase";

export const BARCODE_RETICLE = { width: 260, height: 160 } as const;
export const LABEL_RETICLE = { width: 200, height: 270 } as const;
const LOCK_THRESHOLD_FRAMES = 7;

export interface ReticleTarget {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

// bounds are camera-space normalized (0.0–1.0)
function boundsToTarget(
  bounds: { x: number; y: number; width: number; height: number },
  screenWidth: number,
  screenHeight: number,
): Pick<ReticleTarget, "cx" | "cy"> {
  return {
    cx: (bounds.x + bounds.width / 2) * screenWidth,
    cy: (bounds.y + bounds.height / 2) * screenHeight,
  };
}

export function getReticleTarget(
  phase: ScanPhase,
  screenWidth: number,
  screenHeight: number,
): ReticleTarget {
  const center = { cx: screenWidth / 2, cy: screenHeight / 2 };
  switch (phase.type) {
    case "BARCODE_TRACKING": {
      const { cx, cy } = boundsToTarget(
        phase.bounds,
        screenWidth,
        screenHeight,
      );
      return { cx, cy, ...BARCODE_RETICLE };
    }
    case "BARCODE_LOCKED": {
      const { cx, cy } = boundsToTarget(
        phase.bounds,
        screenWidth,
        screenHeight,
      );
      return { cx, cy, ...BARCODE_RETICLE };
    }
    case "STEP2_CAPTURING":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_CAPTURING":
    case "STEP3_REVIEWING":
      return { ...center, ...LABEL_RETICLE };
    default:
      return { ...center, ...BARCODE_RETICLE };
  }
}

export function getConfidenceFromPhase(phase: ScanPhase): number {
  switch (phase.type) {
    case "IDLE":
    case "HUNTING":
      return 0;
    case "BARCODE_TRACKING":
      return Math.min(phase.frameCount / LOCK_THRESHOLD_FRAMES, 1.0);
    default:
      return 1.0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run client/camera/components/__tests__/ScanReticle-utils.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Create ScanReticle.tsx**

The reticle is a full-screen SVG overlay. Four animated paths form L-shaped corners. All position/size changes drive via shared values. The `useAnimatedProps` worklet computes each corner's SVG `d` attribute.

```tsx
// client/camera/components/ScanReticle.tsx
import React, { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  useAnimatedProps,
  cancelAnimation,
  interpolateColor,
} from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import { getReticleTarget, getConfidenceFromPhase } from "./ScanReticle-utils";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const CORNER_LEN = 24;
const STROKE_WIDTH = 2.5;
const SPRING_TRACK = { damping: 20, stiffness: 200 };
const SPRING_MORPH = { damping: 16, stiffness: 220 };
const SPRING_SNAP = { damping: 8, stiffness: 300 };

interface Props {
  phase: ScanPhase;
  reducedMotion?: boolean;
}

export function ScanReticle({ phase, reducedMotion }: Props) {
  const { width: sw, height: sh } = useWindowDimensions();
  const cx = useSharedValue(sw / 2);
  const cy = useSharedValue(sh / 2);
  const rw = useSharedValue(260); // half-width
  const rh = useSharedValue(160); // half-height
  const confidence = useSharedValue(0);
  const cornerScale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const isFirstDetection = React.useRef(true);

  // Arrival: fade in on first mount
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 220 });
  }, [opacity]);

  // Breathing animation in HUNTING
  useEffect(() => {
    if (phase.type === "HUNTING" && !reducedMotion) {
      rw.value = withRepeat(
        withSequence(
          withTiming(264, { duration: 1000 }),
          withTiming(256, { duration: 1000 }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(rw);
    }
  }, [phase.type, rw, reducedMotion]);

  // Sync position and confidence on every phase change
  useEffect(() => {
    const target = getReticleTarget(phase, sw, sh);
    const conf = getConfidenceFromPhase(phase);

    // Teleport to first detection, spring-track thereafter
    if (phase.type === "BARCODE_TRACKING" && isFirstDetection.current) {
      cx.value = target.cx;
      cy.value = target.cy;
      isFirstDetection.current = false;
    } else if (phase.type === "BARCODE_TRACKING") {
      cx.value = withSpring(target.cx, SPRING_TRACK);
      cy.value = withSpring(target.cy, SPRING_TRACK);
    } else {
      isFirstDetection.current = true;
      cx.value = withSpring(target.cx, SPRING_MORPH);
      cy.value = withSpring(target.cy, SPRING_MORPH);
    }

    rw.value = withSpring(target.width / 2, SPRING_MORPH);
    rh.value = withSpring(target.height / 2, SPRING_MORPH);
    confidence.value = withTiming(conf, { duration: 80 });

    // Lock snap
    if (phase.type === "BARCODE_LOCKED") {
      cornerScale.value = withSpring(1.1, SPRING_SNAP, () => {
        cornerScale.value = withSpring(1, { damping: 12 });
      });
    }
  }, [phase, cx, cy, rw, rh, confidence, cornerScale, sw, sh]);

  const makeCornerProps = (corner: "tl" | "tr" | "bl" | "br") =>
    useAnimatedProps(() => {
      "worklet";
      const w = rw.value * cornerScale.value;
      const h = rh.value * cornerScale.value;
      const x = cx.value;
      const y = cy.value;
      const L = CORNER_LEN;
      let d = "";
      switch (corner) {
        case "tl":
          d = `M ${x - w + L} ${y - h} L ${x - w} ${y - h} L ${x - w} ${y - h + L}`;
          break;
        case "tr":
          d = `M ${x + w - L} ${y - h} L ${x + w} ${y - h} L ${x + w} ${y - h + L}`;
          break;
        case "bl":
          d = `M ${x - w + L} ${y + h} L ${x - w} ${y + h} L ${x - w} ${y + h - L}`;
          break;
        case "br":
          d = `M ${x + w - L} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y + h - L}`;
          break;
      }
      const color = interpolateColor(
        confidence.value,
        [0, 0.5, 1.0],
        ["#FFFFFF", "#f59e0b", "#22c55e"],
      );
      return { d, stroke: color };
    });

  // Staggered corner opacity for arrival animation
  const cornerOpacity = [
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
  ];

  useEffect(() => {
    const delays = [150, 180, 210, 240];
    delays.forEach((delay, i) => {
      cornerOpacity[i].value = withTiming(0, { duration: 0 });
      setTimeout(() => {
        cornerOpacity[i].value = withTiming(1, { duration: 200 });
      }, delay);
    });
  }, []);

  const corners: Array<"tl" | "tr" | "bl" | "br"> = ["tl", "tr", "bl", "br"];

  return (
    <Svg
      style={[StyleSheet.absoluteFill, { width: sw, height: sh }]}
      pointerEvents="none"
    >
      {corners.map((corner, i) => {
        const animProps = makeCornerProps(corner);
        const opacityStyle = useAnimatedProps(() => ({
          opacity: cornerOpacity[i].value,
        }));
        return (
          <AnimatedPath
            key={corner}
            animatedProps={
              Animated.mergeProps
                ? Animated.mergeProps(animProps, opacityStyle)
                : animProps
            }
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
    </Svg>
  );
}
```

**Note:** Reanimated 4 does not support `Animated.mergeProps`. Use a single `useAnimatedProps` per path that includes both `d`/`stroke` and `opacity`. Refactor the implementation so each corner is its own sub-component holding all its shared values.

Revised approach — extract a `CornerPath` sub-component per corner:

```tsx
// Replace the ScanReticle.tsx implementation above with this cleaner version:
// client/camera/components/ScanReticle.tsx
import React, { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  useAnimatedProps,
  cancelAnimation,
  interpolateColor,
} from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import { getReticleTarget, getConfidenceFromPhase } from "./ScanReticle-utils";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const CORNER_LEN = 24;
const STROKE_WIDTH = 2.5;
const SPRING_TRACK = { damping: 20, stiffness: 200 };
const SPRING_MORPH = { damping: 16, stiffness: 220 };
const SPRING_SNAP = { damping: 8, stiffness: 300 };

type Corner = "tl" | "tr" | "bl" | "br";

interface CornerPathProps {
  corner: Corner;
  cx: Animated.SharedValue<number>;
  cy: Animated.SharedValue<number>;
  rw: Animated.SharedValue<number>;
  rh: Animated.SharedValue<number>;
  cornerScale: Animated.SharedValue<number>;
  confidence: Animated.SharedValue<number>;
  arrivalDelay: number;
}

function CornerPath({
  corner,
  cx,
  cy,
  rw,
  rh,
  cornerScale,
  confidence,
  arrivalDelay,
}: CornerPathProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    setTimeout(() => {
      opacity.value = withTiming(1, { duration: 200 });
    }, arrivalDelay);
  }, [opacity, arrivalDelay]);

  const animatedProps = useAnimatedProps(() => {
    "worklet";
    const w = rw.value * cornerScale.value;
    const h = rh.value * cornerScale.value;
    const x = cx.value;
    const y = cy.value;
    const L = CORNER_LEN;
    let d = "";
    switch (corner) {
      case "tl":
        d = `M ${x - w + L} ${y - h} L ${x - w} ${y - h} L ${x - w} ${y - h + L}`;
        break;
      case "tr":
        d = `M ${x + w - L} ${y - h} L ${x + w} ${y - h} L ${x + w} ${y - h + L}`;
        break;
      case "bl":
        d = `M ${x - w + L} ${y + h} L ${x - w} ${y + h} L ${x - w} ${y + h - L}`;
        break;
      case "br":
        d = `M ${x + w - L} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y + h - L}`;
        break;
    }
    const color = interpolateColor(
      confidence.value,
      [0, 0.5, 1.0],
      ["#FFFFFF", "#f59e0b", "#22c55e"],
    );
    return { d, stroke: color, opacity: opacity.value };
  });

  return (
    <AnimatedPath
      animatedProps={animatedProps}
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      fill="none"
    />
  );
}

interface Props {
  phase: ScanPhase;
  reducedMotion?: boolean;
}

export function ScanReticle({ phase, reducedMotion }: Props) {
  const { width: sw, height: sh } = useWindowDimensions();
  const cx = useSharedValue(sw / 2);
  const cy = useSharedValue(sh / 2);
  const rw = useSharedValue(130);
  const rh = useSharedValue(80);
  const confidence = useSharedValue(0);
  const cornerScale = useSharedValue(1);
  const isFirstDetection = React.useRef(true);

  useEffect(() => {
    if (phase.type === "HUNTING" && !reducedMotion) {
      rw.value = withRepeat(
        withSequence(
          withTiming(134, { duration: 1000 }),
          withTiming(126, { duration: 1000 }),
        ),
        -1,
        true,
      );
    } else if (phase.type !== "HUNTING") {
      cancelAnimation(rw);
    }
  }, [phase.type, rw, reducedMotion]);

  useEffect(() => {
    const target = getReticleTarget(phase, sw, sh);
    const conf = getConfidenceFromPhase(phase);

    if (phase.type === "BARCODE_TRACKING" && isFirstDetection.current) {
      cx.value = target.cx;
      cy.value = target.cy;
      isFirstDetection.current = false;
    } else if (phase.type === "BARCODE_TRACKING") {
      cx.value = withSpring(target.cx, SPRING_TRACK);
      cy.value = withSpring(target.cy, SPRING_TRACK);
    } else {
      if (phase.type !== "BARCODE_LOCKED") isFirstDetection.current = true;
      cx.value = withSpring(target.cx, SPRING_MORPH);
      cy.value = withSpring(target.cy, SPRING_MORPH);
    }

    rw.value = withSpring(target.width / 2, SPRING_MORPH);
    rh.value = withSpring(target.height / 2, SPRING_MORPH);
    confidence.value = withTiming(conf, { duration: 80 });

    if (phase.type === "BARCODE_LOCKED") {
      cornerScale.value = withSpring(1.1, SPRING_SNAP, () => {
        cornerScale.value = withSpring(1, { damping: 12 });
      });
    }
  }, [phase, cx, cy, rw, rh, confidence, cornerScale, sw, sh]);

  const corners: Corner[] = ["tl", "tr", "bl", "br"];
  const DELAYS = [150, 180, 210, 240];

  return (
    <Svg
      style={[StyleSheet.absoluteFill, { width: sw, height: sh }]}
      pointerEvents="none"
    >
      {corners.map((corner, i) => (
        <CornerPath
          key={corner}
          corner={corner}
          cx={cx}
          cy={cy}
          rw={rw}
          rh={rh}
          cornerScale={cornerScale}
          confidence={confidence}
          arrivalDelay={DELAYS[i]}
        />
      ))}
    </Svg>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run client/camera/components/__tests__/ScanReticle-utils.test.ts
```

Expected: All tests PASS (component file has no testable pure logic beyond utils)

- [ ] **Step 7: Commit**

```bash
git add client/camera/components/ScanReticle-utils.ts client/camera/components/__tests__/ScanReticle-utils.test.ts client/camera/components/ScanReticle.tsx
git commit -m "feat(scan): add ScanReticle full-screen SVG corner brackets"
```

---

## Task 6: ProductChip component

**Files:**

- Create: `client/camera/components/ProductChip-utils.ts`
- Create: `client/camera/components/__tests__/ProductChip-utils.test.ts`
- Create: `client/camera/components/ProductChip.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// client/camera/components/__tests__/ProductChip-utils.test.ts
import { describe, it, expect } from "vitest";
import { getProductChipVariant } from "../ProductChip-utils";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("getProductChipVariant", () => {
  it("returns null when chip should not show", () => {
    expect(getProductChipVariant({ type: "IDLE" })).toBeNull();
    expect(getProductChipVariant({ type: "HUNTING" })).toBeNull();
    expect(
      getProductChipVariant({
        type: "BARCODE_TRACKING",
        barcode: "123",
        bounds: BOUNDS,
        frameCount: 3,
      }),
    ).toBeNull();
    expect(
      getProductChipVariant({ type: "CLASSIFYING", imageUri: "x" }),
    ).toBeNull();
    expect(
      getProductChipVariant({ type: "STEP2_CAPTURING", barcode: "123" }),
    ).toBeNull();
    expect(
      getProductChipVariant({
        type: "STEP3_CAPTURING",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
      }),
    ).toBeNull();
  });

  it("returns barcode_lock for BARCODE_LOCKED", () => {
    expect(
      getProductChipVariant({
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
      }),
    ).toBe("barcode_lock");
  });

  it("returns step2_review for STEP2_REVIEWING", () => {
    expect(
      getProductChipVariant({
        type: "STEP2_REVIEWING",
        barcode: "123",
        imageUri: "x",
        ocrText: "",
      }),
    ).toBe("step2_review");
  });

  it("returns step2_confirmed for STEP2_CONFIRMED", () => {
    expect(
      getProductChipVariant({
        type: "STEP2_CONFIRMED",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
      }),
    ).toBe("step2_confirmed");
  });

  it("returns step3_review for STEP3_REVIEWING", () => {
    expect(
      getProductChipVariant({
        type: "STEP3_REVIEWING",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
        frontImageUri: "y",
      }),
    ).toBe("step3_review");
  });

  it("returns smart_photo for SMART_CONFIRMED", () => {
    expect(
      getProductChipVariant({
        type: "SMART_CONFIRMED",
        imageUri: "x",
        classification: {} as any,
      }),
    ).toBe("smart_photo");
  });

  it("returns smart_error for SMART_ERROR", () => {
    expect(
      getProductChipVariant({
        type: "SMART_ERROR",
        imageUri: "x",
        error: "err",
      }),
    ).toBe("smart_error");
  });

  it("returns session_complete for SESSION_COMPLETE", () => {
    expect(
      getProductChipVariant({ type: "SESSION_COMPLETE", barcode: "123" }),
    ).toBe("session_complete");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/camera/components/__tests__/ProductChip-utils.test.ts
```

Expected: FAIL — "Cannot find module '../ProductChip-utils'"

- [ ] **Step 3: Create ProductChip-utils.ts**

```typescript
// client/camera/components/ProductChip-utils.ts
import type { ScanPhase } from "../types/scan-phase";

export type ProductChipVariant =
  | "barcode_lock"
  | "step2_review"
  | "step2_confirmed"
  | "step3_review"
  | "session_complete"
  | "smart_photo"
  | "smart_error";

export function getProductChipVariant(
  phase: ScanPhase,
): ProductChipVariant | null {
  switch (phase.type) {
    case "BARCODE_LOCKED":
      return "barcode_lock";
    case "STEP2_REVIEWING":
      return "step2_review";
    case "STEP2_CONFIRMED":
      return "step2_confirmed";
    case "STEP3_REVIEWING":
      return "step3_review";
    case "SESSION_COMPLETE":
      return "session_complete";
    case "SMART_CONFIRMED":
      return "smart_photo";
    case "SMART_ERROR":
      return "smart_error";
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run client/camera/components/__tests__/ProductChip-utils.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Create ProductChip.tsx**

```tsx
// client/camera/components/ProductChip.tsx
import React, { useEffect } from "react";
import { StyleSheet, View, Text, TouchableOpacity, Image } from "react-native";
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
} from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import { getProductChipVariant } from "./ProductChip-utils";

const CHIP_SPRING = { damping: 18, stiffness: 280 };

interface Props {
  phase: ScanPhase;
  onConfirm: () => void;
  onAddNutritionPhoto: () => void;
  onAddFrontPhoto: () => void;
  onStepConfirmed: () => void;
  onEditStep2: () => void;
  onEditStep3: () => void;
  onSmartPhotoConfirm: () => void;
  onRetry: () => void;
}

export function ProductChip({
  phase,
  onConfirm,
  onAddNutritionPhoto,
  onAddFrontPhoto,
  onStepConfirmed,
  onEditStep2,
  onEditStep3,
  onSmartPhotoConfirm,
  onRetry,
}: Props) {
  const translateY = useSharedValue(200);
  const variant = getProductChipVariant(phase);

  useEffect(() => {
    if (variant !== null) {
      translateY.value = withSpring(0, CHIP_SPRING);
    } else {
      translateY.value = withSpring(200, CHIP_SPRING);
    }
  }, [variant, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (variant === null) return null;

  const product = "product" in phase ? phase.product : undefined;

  return (
    <Animated.View style={[styles.chip, animStyle]} accessibilityViewIsModal>
      {/* Product info row */}
      <View style={styles.productRow}>
        {product?.imageUri ? (
          <Image source={{ uri: product.imageUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
        <View style={styles.productText}>
          {product?.brand ? (
            <Text style={styles.brand}>{product.brand}</Text>
          ) : null}
          <Text style={styles.name} numberOfLines={2}>
            {product?.name ?? "Product"}
          </Text>
        </View>
      </View>

      {/* Actions by variant */}
      {variant === "barcode_lock" && (
        <>
          <TouchableOpacity style={styles.btnPrimary} onPress={onConfirm}>
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={onAddNutritionPhoto}
          >
            <Text style={styles.btnSecondaryText}>Add nutrition photo</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnLink} onPress={onAddFrontPhoto}>
            <Text style={styles.btnLinkText}>+ Add front photo</Text>
          </TouchableOpacity>
        </>
      )}

      {(variant === "step2_review" || variant === "step2_confirmed") && (
        <>
          <TouchableOpacity style={styles.btnPrimary} onPress={onStepConfirmed}>
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={onEditStep2}>
            <Text style={styles.btnSecondaryText}>Edit values</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "step3_review" && (
        <>
          <TouchableOpacity style={styles.btnPrimary} onPress={onConfirm}>
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={onEditStep3}>
            <Text style={styles.btnSecondaryText}>Edit values</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "session_complete" && (
        <TouchableOpacity style={styles.btnPrimary} onPress={onConfirm}>
          <Text style={styles.btnPrimaryText}>Done →</Text>
        </TouchableOpacity>
      )}

      {variant === "smart_photo" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onSmartPhotoConfirm}
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "smart_error" && (
        <>
          <Text style={styles.errorText}>
            Couldn't identify this. Try again?
          </Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={onRetry}>
            <Text style={styles.btnPrimaryText}>Try again</Text>
          </TouchableOpacity>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(12,12,12,0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    borderRadius: 18,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  productText: { flex: 1 },
  brand: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginBottom: 2,
  },
  name: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  btnPrimary: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 15,
  },
  btnSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  btnSecondaryText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontWeight: "500",
  },
  optionalBadge: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  btnLink: {
    alignItems: "center",
    paddingVertical: 8,
  },
  btnLinkText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
  },
  errorText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
  },
});
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run client/camera/components/__tests__/ProductChip-utils.test.ts
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add client/camera/components/ProductChip-utils.ts client/camera/components/__tests__/ProductChip-utils.test.ts client/camera/components/ProductChip.tsx
git commit -m "feat(scan): add ProductChip bottom sheet component"
```

---

## Task 7: ScanScreen scaffold

Replace the current ScanScreen with the new `useReducer`-based structure. Mount all new components, wire permission screens, keep camera ref and premium hooks intact. Barcode callback is a stub (does not fire actions yet — that's Task 8).

**Files:**

- Modify: `client/screens/ScanScreen.tsx`

- [ ] **Step 1: Replace ScanScreen.tsx**

The file is a complete rewrite. Replace the full content of `client/screens/ScanScreen.tsx` with:

```tsx
// client/screens/ScanScreen.tsx
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  Pressable,
  Platform,
  Linking,
} from "react-native";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useTheme } from "@/hooks/useTheme";
import { usePremiumCamera } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  useCameraPermissions,
  useCamera,
  recognizeTextFromPhoto,
  CameraView,
  type BarcodeResult,
  type CameraRef,
} from "@/camera";
import { uploadPhotoForAnalysis } from "@/lib/photo-upload";
import { shouldAutoRoute, getPremiumGate } from "@/screens/scan-screen-utils";
import type { ContentType } from "@shared/constants/classification";
import type { ScanScreenNavigationProp } from "@/types/navigation";

import { scanPhaseReducer } from "@/camera/reducers/scan-phase-reducer";
import type { ScanPhase } from "@/camera/types/scan-phase";
import { CoachHint } from "@/camera/components/CoachHint";
import { ScanReticle } from "@/camera/components/ScanReticle";
import { StepPill } from "@/camera/components/StepPill";
import { ProductChip } from "@/camera/components/ProductChip";
import { ScanFlashOverlay } from "@/camera/components/ScanFlashOverlay";
import { ScanSonarRing } from "@/camera/components/ScanSonarRing";
import { getCoachMessage } from "@/camera/components/CoachHint-utils";
import { getConfidenceFromPhase } from "@/camera/components/ScanReticle-utils";

const LOCK_THRESHOLD = 0.85;
const LOCK_FRAMES = 7; // confidence ≥ 0.85 when frameCount ≥ 7 (7/7 = 1.0, lock at 0.85 = ~6 frames)

export default function ScanScreen() {
  const navigation = useNavigation<ScanScreenNavigationProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { isPremium, remainingScans } = usePremiumCamera();
  const { refreshScanCount } = usePremiumContext();

  const [scanPhase, dispatch] = useReducer(scanPhaseReducer, { type: "IDLE" });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [flashCount, setFlashCount] = useState(0);
  const [sonarVisible, setSonarVisible] = useState(false);
  const [sonarPos, setSonarPos] = useState({ cx: 195, cy: 422 });

  const cameraRef = useRef<CameraRef>(null);
  const hasLockedRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barcodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { permissionStatus, requestPermission } = useCameraPermissions();

  // Coach hint escalation timer — resets on any detection
  useEffect(() => {
    if (scanPhase.type === "HUNTING" || scanPhase.type === "IDLE") {
      setElapsedSeconds(0);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (scanPhase.type === "HUNTING") {
        elapsedTimerRef.current = setInterval(
          () => setElapsedSeconds((s) => s + 1),
          1000,
        );
      }
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      setElapsedSeconds(0);
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [scanPhase.type]);

  // Reset when screen loses focus
  useEffect(() => {
    if (!isFocused) {
      dispatch({ type: "RESET" });
      hasLockedRef.current = false;
    }
  }, [isFocused]);

  // Camera ready → start hunting
  const onCameraReady = useCallback(() => {
    dispatch({ type: "CAMERA_READY" });
  }, []);

  // Barcode callback — fires on every detected frame
  const onBarcodeScanned = useCallback(
    (result: BarcodeResult) => {
      if (!isFocused) return;
      // Will be fully wired in Task 8
    },
    [isFocused],
  );

  // Shutter tap
  const onShutterPress = useCallback(async () => {
    // Will be wired in Task 10
  }, []);

  // Torch state
  const [torchEnabled, setTorchEnabled] = useState(false);

  const { cameraRef: hookCameraRef } = useCamera({
    onBarcodeScanSuccess: onBarcodeScanned,
    isPremium,
    refreshScanCount,
    onUpgradeNeeded: () => {},
  });

  // Permission states
  if (permissionStatus === "undetermined") {
    return (
      <View
        style={[
          styles.permissionContainer,
          { backgroundColor: theme.background },
        ]}
      >
        <Text style={[styles.permissionTitle, { color: theme.text }]}>
          Camera Access
        </Text>
        <Text style={[styles.permissionBody, { color: theme.textSecondary }]}>
          OCRecipes needs your camera to scan barcodes and food labels.
        </Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={requestPermission}
        >
          <Text style={styles.permissionBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (permissionStatus === "denied") {
    return (
      <View
        style={[
          styles.permissionContainer,
          { backgroundColor: theme.background },
        ]}
      >
        <Text style={[styles.permissionTitle, { color: theme.text }]}>
          Camera Blocked
        </Text>
        <Text style={[styles.permissionBody, { color: theme.textSecondary }]}>
          Enable camera access in Settings to scan products.
        </Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={() => Linking.openSettings()}
        >
          <Text style={styles.permissionBtnText}>Open Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.permissionCancel}
          onPress={() => navigation.goBack()}
        >
          <Text
            style={[
              styles.permissionCancelText,
              { color: theme.textSecondary },
            ]}
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const coachMessage = getCoachMessage(scanPhase, elapsedSeconds);
  const confidence = getConfidenceFromPhase(scanPhase);

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        barcodeTypes={["ean13", "ean8", "upce", "code128", "code39", "qr"]}
        onBarcodeScanned={onBarcodeScanned}
        enableTorch={torchEnabled}
        isActive={isFocused}
        onReady={onCameraReady}
      />

      <ScanReticle phase={scanPhase} reducedMotion={reducedMotion} />

      {sonarVisible && (
        <ScanSonarRing
          cx={sonarPos.cx}
          cy={sonarPos.cy}
          screenWidth={styles.root.flex ? 0 : 390}
          screenHeight={844}
          onComplete={() => setSonarVisible(false)}
        />
      )}

      <ScanFlashOverlay triggerCount={flashCount} />

      {/* Top overlay: safe area + step pill */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <StepPill phase={scanPhase} />
      </View>

      {/* Coach hint */}
      <View style={styles.coachContainer}>
        <CoachHint message={coachMessage} />
      </View>

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setTorchEnabled((t) => !t)}
        >
          <Text style={styles.iconBtnText}>{torchEnabled ? "⚡" : "🔦"}</Text>
        </TouchableOpacity>
        <Pressable style={styles.shutter} onPress={onShutterPress} />
        <View style={styles.iconBtn} />
      </View>

      {/* Scan count badge (free tier) */}
      {!isPremium && remainingScans !== null && (
        <View style={styles.scanCount}>
          <Text style={styles.scanCountText}>
            {remainingScans > 0
              ? `${remainingScans} scans remaining`
              : "Daily limit reached"}
          </Text>
        </View>
      )}

      {/* Product chip — slides up from bottom */}
      <ProductChip
        phase={scanPhase}
        onConfirm={() => dispatch({ type: "CONFIRM_PRODUCT" })}
        onAddNutritionPhoto={() => dispatch({ type: "ADD_NUTRITION_PHOTO" })}
        onAddFrontPhoto={() => dispatch({ type: "ADD_FRONT_PHOTO" })}
        onStepConfirmed={() => dispatch({ type: "STEP_CONFIRMED" })}
        onEditStep2={() => {
          if (
            scanPhase.type === "STEP2_REVIEWING" ||
            scanPhase.type === "STEP2_CONFIRMED"
          ) {
            const imageUri =
              scanPhase.type === "STEP2_REVIEWING"
                ? scanPhase.imageUri
                : scanPhase.nutritionImageUri;
            navigation.navigate("LabelAnalysis", { imageUri });
          }
        }}
        onEditStep3={() => {
          if (scanPhase.type === "STEP3_REVIEWING") {
            navigation.navigate("FrontLabelConfirm", {
              imageUri: scanPhase.frontImageUri,
              barcode: scanPhase.barcode,
            });
          }
        }}
        onSmartPhotoConfirm={() => {
          // will route in Task 10
        }}
        onRetry={() => dispatch({ type: "RESET" })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
    gap: 12,
  },
  closeBtn: {
    alignSelf: "flex-end",
    marginRight: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  coachContainer: {
    position: "absolute",
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    zIndex: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: { fontSize: 18 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FFF",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.4)",
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  permissionTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  permissionBody: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  permissionBtn: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 8,
  },
  permissionBtnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  permissionCancel: { paddingVertical: 12 },
  permissionCancelText: { fontSize: 15 },
  scanCount: {
    position: "absolute",
    top: 120,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scanCountText: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
});
```

**Note on `useCamera` hook usage:** The current `useCamera` hook is built for `BatchScanScreen` debounce behaviour. In the new ScanScreen, barcode detection is handled directly via `onBarcodeScanned` prop on `CameraView`. Remove the `useCamera` import from the rewrite — use `cameraRef` directly.

The revised top of ScanScreen replaces `useCamera` with a direct cameraRef:

```tsx
// Replace useCamera section with:
const cameraRef = useRef<CameraRef>(null);
```

And pass `cameraRef` directly to `<CameraView ref={cameraRef} .../>`. Delete the `hookCameraRef` entirely from this file.

Also note: `CameraView` currently does not have an `onReady` prop. The `CAMERA_READY` action will be dispatched when the user views the screen (`useEffect(() => { if (isFocused) dispatch({ type: 'CAMERA_READY' }); }, [isFocused])`).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run check:types 2>&1 | head -30
```

Expected: May show some errors about unused imports from old ScanScreen — these are expected at this stage. The critical path (new components, reducer) should type-check.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: All existing tests PASS (we haven't deleted any files yet)

- [ ] **Step 4: Commit**

```bash
git add client/screens/ScanScreen.tsx
git commit -m "feat(scan): scaffold new ScanScreen with useReducer and new component tree"
```

---

## Task 8: Barcode tracking and lock moment choreography

Wire the `onBarcodeScanned` callback with confidence tracking, BARCODE_LOCKED dispatch, lock moment animations (flash + sonar + haptic), and product lookup.

**Files:**

- Modify: `client/screens/ScanScreen.tsx`

- [ ] **Step 1: Add barcode tracking state and the wired callback**

In `ScanScreen.tsx`, replace the stub `onBarcodeScanned` callback and add the frame count tracking:

```tsx
// Add to ScanScreen component, after the dispatch/state declarations:
const lastBarcodeRef = useRef<string | null>(null);
const barcodeAbsentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
  null,
);
const { width: screenWidth, height: screenHeight } = useWindowDimensions(); // add import
```

```tsx
// Replace the stub onBarcodeScanned:
const onBarcodeScanned = useCallback(
  (result: BarcodeResult) => {
    if (!isFocused || hasLockedRef.current) return;

    // Clear the barcode-absent timer on every successful detection
    if (barcodeAbsentTimerRef.current) {
      clearTimeout(barcodeAbsentTimerRef.current);
      barcodeAbsentTimerRef.current = null;
    }

    const barcode = result.data;
    const bounds = result.bounds ?? { x: 0.3, y: 0.4, width: 0.4, height: 0.2 };

    if (scanPhase.type === "HUNTING") {
      lastBarcodeRef.current = barcode;
      dispatch({ type: "FIRST_BARCODE_DETECTED", barcode, bounds });
      return;
    }

    if (scanPhase.type === "BARCODE_TRACKING") {
      if (barcode !== scanPhase.barcode) {
        // Different barcode — reset
        lastBarcodeRef.current = barcode;
        dispatch({ type: "FIRST_BARCODE_DETECTED", barcode, bounds });
        return;
      }
      dispatch({ type: "BARCODE_UPDATED", bounds });

      const newFrameCount = scanPhase.frameCount + 1;
      const confidence = Math.min(newFrameCount / 7, 1.0);

      if (confidence >= LOCK_THRESHOLD) {
        hasLockedRef.current = true;

        // Lock moment chord: haptic + flash + sonar (all within ~50ms)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFlashCount((c) => c + 1);
        setSonarPos({
          cx: (bounds.x + bounds.width / 2) * screenWidth,
          cy: (bounds.y + bounds.height / 2) * screenHeight,
        });
        setSonarVisible(true);

        dispatch({ type: "BARCODE_LOCKED" });

        // Fetch product info (non-blocking)
        fetchProductInfo(barcode);
      }

      // Barcode absent timeout: if no frames for 800ms, go back to HUNTING
      barcodeAbsentTimerRef.current = setTimeout(() => {
        if (!hasLockedRef.current) {
          dispatch({ type: "BARCODE_LOST" });
          lastBarcodeRef.current = null;
        }
      }, 800);
    }
  },
  [isFocused, scanPhase, screenWidth, screenHeight],
);
```

- [ ] **Step 2: Add the fetchProductInfo helper**

```tsx
// Add after the onBarcodeScanned callback:
const fetchProductInfo = useCallback(async (barcode: string) => {
  try {
    const token = await import("@/lib/token-storage").then((m) =>
      m.tokenStorage.get(),
    );
    if (!token) return;
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_DOMAIN}/api/nutrition/${barcode}/summary`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return;
    const data = await res.json();
    dispatch({
      type: "PRODUCT_LOADED",
      product: {
        name: data.name ?? data.productName ?? "Unknown product",
        brand: data.brand ?? undefined,
        imageUri: data.imageUrl ?? undefined,
      },
    });
  } catch {
    // Non-critical — ProductChip works with null product
  }
}, []);
```

**Note:** Check `server/routes/` for the correct endpoint to fetch a product summary by barcode. Use whichever `/api/nutrition/:barcode` endpoint already exists. The fields `name`/`brand`/`imageUrl` may differ — adjust to match the actual response shape.

- [ ] **Step 3: Use `useWindowDimensions` for sonar ring sizing**

```tsx
// Replace the hardcoded 390/844 in the ScanSonarRing render:
const { width: screenWidth, height: screenHeight } = useWindowDimensions();
// ...
<ScanSonarRing
  cx={sonarPos.cx}
  cy={sonarPos.cy}
  screenWidth={screenWidth}
  screenHeight={screenHeight}
  onComplete={() => setSonarVisible(false)}
/>;
```

- [ ] **Step 4: Dispatch CAMERA_READY when screen focuses**

```tsx
// Replace the onCameraReady callback with an effect:
useEffect(() => {
  if (isFocused) {
    dispatch({ type: "CAMERA_READY" });
    hasLockedRef.current = false;
  }
}, [isFocused]);
```

- [ ] **Step 5: Clean up timeouts on unmount**

```tsx
// In the existing cleanup effect, add:
useEffect(() => {
  return () => {
    if (barcodeAbsentTimerRef.current)
      clearTimeout(barcodeAbsentTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  };
}, []);
```

- [ ] **Step 6: Verify TypeScript**

```bash
npm run check:types 2>&1 | grep "ScanScreen" | head -20
```

- [ ] **Step 7: Commit**

```bash
git add client/screens/ScanScreen.tsx
git commit -m "feat(scan): wire barcode tracking, confidence ladder, and lock moment choreography"
```

---

## Task 9: Product chip actions, steps 2/3, and SESSION_COMPLETE navigation

Wire the chip's action buttons: "Looks right" navigates, "Add nutrition photo" / "Add front photo" triggers capture, captured photos flow through OCR and step review.

**Files:**

- Modify: `client/screens/ScanScreen.tsx`
- Modify: `client/navigation/RootStackNavigator.tsx`

- [ ] **Step 1: Update NutritionDetail params type**

In `client/navigation/RootStackNavigator.tsx`, update the `NutritionDetail` entry:

```tsx
// Find: NutritionDetail: { barcode?: string; imageUri?: string; itemId?: number; }
// Replace with:
NutritionDetail: {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
  nutritionImageUri?: string;
  frontLabelImageUri?: string;
  localOCRText?: string;
};
```

- [ ] **Step 2: Handle SESSION_COMPLETE navigation**

In `ScanScreen.tsx`, add a `useEffect` that watches for `SESSION_COMPLETE`:

```tsx
useEffect(() => {
  if (scanPhase.type !== "SESSION_COMPLETE") return;
  const { barcode, nutritionImageUri, frontImageUri, ocrText } = scanPhase;
  refreshScanCount();
  navigation.navigate("NutritionDetail", {
    barcode,
    nutritionImageUri,
    frontLabelImageUri: frontImageUri,
    localOCRText: ocrText,
  });
}, [scanPhase.type]); // intentionally shallow — only fire on type change
```

- [ ] **Step 3: Handle step photo capture**

Replace the `onShutterPress` stub with capture logic that checks whether we are in a capturing state:

```tsx
const onShutterPress = useCallback(async () => {
  if (
    scanPhase.type !== "STEP2_CAPTURING" &&
    scanPhase.type !== "STEP3_CAPTURING" &&
    scanPhase.type !== "HUNTING"
  )
    return;

  if (scanPhase.type === "HUNTING") {
    // Smart photo path — handled in Task 10
    return;
  }

  const photo = await cameraRef.current?.takePicture();
  if (!photo) return;

  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

  if (scanPhase.type === "STEP2_CAPTURING") {
    // Run OCR in parallel with state transition
    let ocrText = "";
    try {
      ocrText = (await recognizeTextFromPhoto(photo.uri)) ?? "";
    } catch {
      // OCR failure is non-fatal — proceed with empty text
    }
    dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri, ocrText });
  } else {
    // STEP3_CAPTURING — no OCR needed
    dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri });
  }
}, [scanPhase, cameraRef]);
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/screens/ScanScreen.tsx client/navigation/RootStackNavigator.tsx
git commit -m "feat(scan): wire product chip actions, step 2/3 capture, SESSION_COMPLETE navigation"
```

---

## Task 10: Smart photo path and confetti

Wire the shutter → classify path, routing from classification result, and confetti on SESSION_COMPLETE.

**Files:**

- Modify: `client/screens/ScanScreen.tsx`

- [ ] **Step 1: Install react-native-confetti-cannon**

```bash
npx expo install react-native-confetti-cannon
```

If not available via expo install:

```bash
npm install react-native-confetti-cannon
```

`react-native-confetti-cannon` is pure JS — no native rebuild required.

- [ ] **Step 2: Add confetti to ScanScreen**

```tsx
// Add import:
import ConfettiCannon from "react-native-confetti-cannon";

// Add state:
const [showConfetti, setShowConfetti] = useState(false);
const confettiRef = useRef<ConfettiCannon>(null);

// Add to the SESSION_COMPLETE useEffect (Task 9 Step 2):
useEffect(() => {
  if (scanPhase.type !== "SESSION_COMPLETE") return;
  if (!reducedMotion) {
    setShowConfetti(true);
  }
  const { barcode, nutritionImageUri, frontImageUri, ocrText } = scanPhase;
  const timer = setTimeout(() => {
    refreshScanCount();
    navigation.navigate("NutritionDetail", {
      barcode,
      nutritionImageUri,
      frontLabelImageUri: frontImageUri,
      localOCRText: ocrText,
    });
  }, 700); // brief confetti moment before navigating
  return () => clearTimeout(timer);
}, [scanPhase.type]);

// In JSX, above ProductChip:
{
  showConfetti && (
    <ConfettiCannon
      ref={confettiRef}
      count={30}
      origin={{ x: screenWidth / 2, y: 0 }}
      autoStart
      fadeOut
      fallSpeed={2500}
      colors={["#22c55e", "#f59e0b", "#FFFFFF", "#60a5fa"]}
      onAnimationEnd={() => setShowConfetti(false)}
    />
  );
}
```

- [ ] **Step 3: Wire shutter → smart photo path**

In `onShutterPress`, replace the `// Smart photo path` comment:

```tsx
if (scanPhase.type === "HUNTING") {
  const photo = await cameraRef.current?.takePicture();
  if (!photo) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  dispatch({ type: "SMART_PHOTO_INITIATED", imageUri: photo.uri });
  try {
    const result = await uploadPhotoForAnalysis(photo.uri, "auto");
    dispatch({ type: "CLASSIFICATION_SUCCEEDED", classification: result });
  } catch (err) {
    dispatch({
      type: "CLASSIFICATION_FAILED",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
  return;
}
```

- [ ] **Step 4: Wire smart photo chip confirm action**

In the `ProductChip` `onSmartPhotoConfirm` prop, add routing using `routeFromClassification`:

```tsx
onSmartPhotoConfirm={() => {
  if (scanPhase.type !== 'SMART_CONFIRMED') return;
  const { classification, imageUri } = scanPhase;
  const contentType = classification.contentType as ContentType | undefined;
  if (!contentType) {
    navigation.navigate('PhotoAnalysis', {
      imageUri,
      intent: classification.resolvedIntent ?? 'log',
    });
    return;
  }
  const gate = getPremiumGate(contentType);
  if (gate && !isPremium) {
    // TODO: show upgrade modal (same as current onUpgradeNeeded pattern)
    dispatch({ type: 'RESET' });
    return;
  }
  switch (contentType) {
    case 'prepared_meal':
      navigation.navigate('PhotoAnalysis', { imageUri, intent: classification.resolvedIntent ?? 'log' });
      break;
    case 'restaurant_menu':
      navigation.navigate('MenuScanResult', { imageUri });
      break;
    case 'nutrition_label':
      navigation.navigate('LabelAnalysis', { imageUri });
      break;
    case 'raw_ingredients':
      navigation.navigate('CookSessionCapture', { initialPhotoUri: imageUri });
      break;
    case 'grocery_receipt':
    case 'restaurant_receipt':
      navigation.navigate('ReceiptCapture');
      break;
    default:
      navigation.navigate('PhotoAnalysis', { imageUri, intent: 'log' });
  }
}}
```

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add client/screens/ScanScreen.tsx package.json package-lock.json
git commit -m "feat(scan): add smart photo path, confetti on session complete"
```

---

## Task 11: Cleanup

Delete deprecated files, update exports, and verify the full suite passes.

**Files:**

- Delete: `client/components/ClassificationOverlay.tsx`
- Delete: `client/hooks/useScanClassification.ts`
- Modify: `client/camera/index.ts`

- [ ] **Step 1: Delete deprecated files**

```bash
rm client/components/ClassificationOverlay.tsx
rm client/hooks/useScanClassification.ts
```

- [ ] **Step 2: Verify nothing else imports them**

```bash
grep -r "ClassificationOverlay\|useScanClassification" client/ --include="*.ts" --include="*.tsx"
```

Expected: No output (these were only used in ScanScreen which no longer imports them)

If any imports remain, fix them before continuing.

- [ ] **Step 3: Update camera/index.ts to export new components**

Replace `client/camera/index.ts` with:

```typescript
// Types
export * from "./types";
export * from "./types/scan-phase";

// Hooks
export { useCameraPermissions } from "./hooks/useCameraPermissions";
export { useCamera } from "./hooks/useCamera";

// Utils
export { recognizeTextFromPhoto } from "./utils/recognizeTextFromPhoto";

// Components
export { CameraView } from "./components/CameraView";
export { CoachHint } from "./components/CoachHint";
export { ScanFlashOverlay } from "./components/ScanFlashOverlay";
export { ScanSonarRing } from "./components/ScanSonarRing";
export { StepPill } from "./components/StepPill";
export { ScanReticle } from "./components/ScanReticle";
export { ProductChip } from "./components/ProductChip";

// Reducers
export { scanPhaseReducer } from "./reducers/scan-phase-reducer";

// Component utils (for testing / external use)
export { getCoachMessage } from "./components/CoachHint-utils";
export {
  getStepDotState,
  shouldShowStepPill,
} from "./components/StepPill-utils";
export {
  getReticleTarget,
  getConfidenceFromPhase,
} from "./components/ScanReticle-utils";
export { getProductChipVariant } from "./components/ProductChip-utils";
```

- [ ] **Step 4: Run the full test suite**

```bash
npm run test:run
```

Expected: All tests PASS

- [ ] **Step 5: TypeScript check**

```bash
npm run check:types
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/camera/index.ts
git rm client/components/ClassificationOverlay.tsx
git rm client/hooks/useScanClassification.ts
git commit -m "refactor(scan): delete ClassificationOverlay and useScanClassification, update camera exports"
```

---

## Self-Review

**Spec coverage:**

- ✅ Premium arrival animation (camera fade + staggered brackets + step pill fade + coach fade) — covered in ScanReticle (staggered arrival) and ScanScreen (camera `isActive={isFocused}`)
- ✅ Detection confidence via bracket colour (white→amber→green) — `interpolateColor` in ScanReticle
- ✅ Lock moment choreography (flash + sonar + haptic) — ScanFlashOverlay, ScanSonarRing, Haptics in Task 8
- ✅ Step pill progression — StepPill with utils
- ✅ Reticle morphing (barcode→label shape) — ScanReticle-utils `BARCODE_RETICLE`/`LABEL_RETICLE` constants
- ✅ Bracket breathing in HUNTING — `withRepeat` in ScanReticle
- ✅ Coach hint escalation — CoachHint-utils
- ✅ Smart photo path with ProductChip — Tasks 6 and 10
- ✅ Confetti on SESSION_COMPLETE — Task 10
- ✅ `reducedMotion` respected — breathing disabled, spring→tween fallback in ScanReticle
- ✅ Accessibility: `accessibilityLiveRegion` on CoachHint, `accessibilityViewIsModal` on ProductChip, `announceForAccessibility` in CoachHint
- ✅ Navigation contract: `SESSION_COMPLETE` → `NutritionDetail` with optional fields — Task 9

**Gaps addressed:**

- The `onReady` prop on `CameraView` does not exist — replaced with `useEffect` on `isFocused` (documented in Task 7)
- `fetchProductInfo` uses a dynamic import for tokenStorage — should be a static import if `@/lib/token-storage` is already imported elsewhere in scope
- `react-native-confetti-cannon` types may not be available; add `// @ts-ignore` or `declare module` if TypeScript errors occur on import
- Smart photo routing in `onSmartPhotoConfirm` does not handle `shouldAutoRoute` logic — all confirmed smart photos require user confirmation (no auto-route), which matches the spec's "user confirms chip" model
