# Scan Camera Experience Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the manual "arm next photo" tap from ScanScreen's barcode → nutrition-label → front-label capture flow (which structurally collides with the shutter button), add tap-to-focus and pinch-to-zoom, and give the step indicator a sliding-highlight animation.

**Architecture:** Collapse `STEP2_CAPTURING`/`STEP3_CAPTURING` out of the `ScanPhase` state machine — `BARCODE_LOCKED` and `STEP2_CONFIRMED` themselves become the "armed and ready to capture" states, so the shutter is live the instant the prior step resolves with no separate arming action. A component-level auto-advance timer (screen-reader-aware) replaces the explicit "Confirm"/"Edit values" gate after each capture. Tap-to-focus and pinch-to-zoom are added as a shared gesture hook consumed by both platform `CameraView` variants, using VisionCamera v5's native `focusTo()`/`zoom` APIs.

**Tech Stack:** React Native 0.81, Expo, `react-native-vision-camera` v5.0.11, `react-native-reanimated` ~4.3.1, `react-native-gesture-handler` ~2.28.0, Vitest + React Native Testing Library (`@testing-library/react`, jsdom environment).

## Global Constraints

- Every source file lives under `client/` (this project's mono-repo client root) using the `@/` path alias for `client/*` and `@shared/` for `shared/*`.
- Test command: `npx vitest run <path>` (project script: `npm run test:run` runs everything; scope to the specific file while iterating).
- Any function imported from another module and called inside a Reanimated worklet (gesture `.onUpdate`/`.onStart`, `useAnimatedStyle`, `runOnUI`, etc.) MUST have `"worklet";` as its literal first statement, or it silently crashes release/OTA builds despite passing `tsc`/ESLint/unit tests. Enforced repo-wide by `scripts/__tests__/worklet-directive-guard.test.ts` (an integration test that scans all of `client/` automatically — no per-file registration needed).
- No comments explaining WHAT code does — only WHY, and only for non-obvious constraints (this repo's established convention; see any existing file in `client/camera/` for the tone).
- Do not modify `docs/superpowers/specs/2026-07-14-scan-camera-experience-overhaul-design.md` — it's the source spec, already approved.

---

## Task 1: Collapse the capturing states out of the ScanPhase state machine

**Files:**

- Modify: `client/camera/types/scan-phase.ts`
- Modify: `client/camera/reducers/scan-phase-reducer.ts`
- Modify: `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`

**Interfaces:**

- Produces: `ScanPhase` no longer has `STEP2_CAPTURING`/`STEP3_CAPTURING` variants. `BARCODE_LOCKED` and `STEP2_CONFIRMED` are now the "armed, shutter live" states directly. `ScanAction` no longer has `ADD_NUTRITION_PHOTO`/`ADD_FRONT_PHOTO`. `STEP_PHOTO_CAPTURED` now transitions from `BARCODE_LOCKED` → `STEP2_REVIEWING` and from `STEP2_CONFIRMED` → `STEP3_REVIEWING` (previously from `STEP2_CAPTURING`/`STEP3_CAPTURING`). `PRODUCT_LOADED` now only applies to `BARCODE_LOCKED` (previously also `STEP2_CAPTURING`, which no longer exists — behaviorally identical window, since that phase is now folded into `BARCODE_LOCKED`).

- [ ] **Step 1: Update the failing/changed reducer tests first**

Replace the two `ADD_NUTRITION_PHOTO`/`ADD_FRONT_PHOTO` tests and the two `STEP_PHOTO_CAPTURED` tests in `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`, and fix the "ignores actions" test that references the removed action type. Apply this diff (replace the named blocks; leave everything else in the file untouched):

Replace:

```typescript
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
```

With:

```typescript
it("STEP_PHOTO_CAPTURED from BARCODE_LOCKED → STEP2_REVIEWING (armed by lock, no separate arm action)", () => {
  const state: ScanPhase = {
    type: "BARCODE_LOCKED",
    barcode: "123",
    bounds: BOUNDS,
    product: { name: "Bar" },
  };
  const result = scanPhaseReducer(state, {
    type: "STEP_PHOTO_CAPTURED",
    imageUri: "file://photo.jpg",
    ocrText: "Calories 200",
  });
  expect(result).toEqual({
    type: "STEP2_REVIEWING",
    barcode: "123",
    product: { name: "Bar" },
    imageUri: "file://photo.jpg",
    ocrText: "Calories 200",
  });
});
```

Replace:

```typescript
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
```

With:

```typescript
it("STEP_PHOTO_CAPTURED from STEP2_CONFIRMED → STEP3_REVIEWING (armed by nutrition confirm, no separate arm action)", () => {
  const state: ScanPhase = {
    type: "STEP2_CONFIRMED",
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
```

Replace:

```typescript
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
```

With:

```typescript
it("ignores actions that do not apply to the current phase", () => {
  const state: ScanPhase = { type: "HUNTING" };
  expect(
    scanPhaseReducer(state, { type: "BARCODE_UPDATED", bounds: BOUNDS }),
  ).toEqual(state);
  expect(scanPhaseReducer(state, { type: "BARCODE_LOCKED" })).toEqual(state);
  expect(
    scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://x.jpg",
    }),
  ).toEqual(state);
});
```

- [ ] **Step 2: Run the test file to see it fail (types won't compile yet — expected)**

Run: `npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts`
Expected: FAIL — TypeScript error, `ADD_NUTRITION_PHOTO`/`ADD_FRONT_PHOTO` still exist on `ScanAction` at this point so the removed-block replacement compiles fine, but the new `STEP_PHOTO_CAPTURED`-from-`BARCODE_LOCKED` test fails at runtime because the reducer hasn't changed yet: `expected { type: 'STEP2_REVIEWING', ... } to equal { type: 'BARCODE_LOCKED', barcode: '123', bounds: undefined, product: { name: 'Bar' } }` (the reducer's current `STEP_PHOTO_CAPTURED` case no-ops on `BARCODE_LOCKED`, returning state unchanged).

- [ ] **Step 3: Update `client/camera/types/scan-phase.ts`**

Remove the `STEP2_CAPTURING` and `STEP3_CAPTURING` members from `ScanPhase`, and the `ADD_NUTRITION_PHOTO`/`ADD_FRONT_PHOTO` members from `ScanAction`. Full resulting file:

```typescript
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
  | { type: "STEP_PHOTO_CAPTURED"; imageUri: string; ocrText?: string }
  | { type: "STEP_CONFIRMED" }
  | { type: "SMART_PHOTO_INITIATED"; imageUri: string }
  | { type: "CLASSIFICATION_SUCCEEDED"; classification: PhotoAnalysisResponse }
  | { type: "CLASSIFICATION_FAILED"; error: string }
  | { type: "SMART_CONFIRM_FAILED" }
  | { type: "RESET" };
```

- [ ] **Step 4: Update `client/camera/reducers/scan-phase-reducer.ts`**

Remove the `ADD_NUTRITION_PHOTO` and `ADD_FRONT_PHOTO` cases entirely, simplify the `PRODUCT_LOADED` guard to only check `BARCODE_LOCKED`, and change `STEP_PHOTO_CAPTURED` to key off `BARCODE_LOCKED`/`STEP2_CONFIRMED` instead of `STEP2_CAPTURING`/`STEP3_CAPTURING`. Full resulting file:

```typescript
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
      if (state.type !== "BARCODE_LOCKED") return state;
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

    case "STEP_PHOTO_CAPTURED":
      if (state.type === "BARCODE_LOCKED") {
        return {
          type: "STEP2_REVIEWING",
          barcode: state.barcode,
          product: state.product,
          imageUri: action.imageUri,
          ocrText: action.ocrText ?? "",
        };
      }
      if (state.type === "STEP2_CONFIRMED") {
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

    case "SMART_CONFIRM_FAILED":
      if (state.type !== "SMART_CONFIRMED") return state;
      return {
        type: "SMART_ERROR",
        imageUri: state.imageUri,
        error: "unrecognized",
      };

    case "RESET":
      return { type: "IDLE" };

    default:
      return state;
  }
}
```

- [ ] **Step 5: Run the test file to verify it passes**

Run: `npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts`
Expected: PASS (all tests green — `18 passed`, no `ADD_NUTRITION_PHOTO`/`ADD_FRONT_PHOTO` references left).

- [ ] **Step 6: Typecheck to confirm no other file references the removed action/phase types**

Run: `npx tsc --noEmit`
Expected: Errors in `client/screens/ScanScreen.tsx`, `client/camera/components/ProductChip.tsx`, `client/camera/components/ProductChip-utils.ts` (if applicable), and `client/camera/components/__tests__/ProductChip.a11y.test.tsx` — these are EXPECTED at this point in the plan and get fixed in Tasks 3 and 4/5. Confirm the errors are ONLY in those files (nowhere else references `STEP2_CAPTURING`/`STEP3_CAPTURING`/`ADD_NUTRITION_PHOTO`/`ADD_FRONT_PHOTO`).

- [ ] **Step 7: Commit**

```bash
git add client/camera/types/scan-phase.ts client/camera/reducers/scan-phase-reducer.ts client/camera/reducers/__tests__/scan-phase-reducer.test.ts
git commit -m "feat(scan): collapse capturing states into armed lock/confirm states"
```

---

## Task 2: Extend `getStepDotState` and add a sliding step-index helper

**Files:**

- Modify: `client/camera/components/StepPill-utils.ts`
- Create: `client/camera/components/__tests__/StepPill-utils.test.ts` additions (file exists — add new tests, don't remove existing ones for unaffected phases)

**Interfaces:**

- Consumes: `ScanPhase` from Task 1 (no more `STEP2_CAPTURING`/`STEP3_CAPTURING`).
- Produces: `getStepDotState(phase, stepIndex): StepDotState` updated for the collapsed phases. New `getActiveStepIndex(phase: ScanPhase): 0 | 1 | 2 | null` — drives the StepPill sliding-bar position in Task 3's `StepPill.tsx`.

- [ ] **Step 1: Read the existing test file to see current coverage**

Read `client/camera/components/__tests__/StepPill-utils.test.ts` in full before editing — it already has cases for `STEP2_CAPTURING`/`STEP3_CAPTURING` that need updating to match Task 1's collapsed phases, plus a new `describe` block for `getActiveStepIndex`. Since the exact current test names aren't reproduced here, locate any `it(...)` blocks referencing `STEP2_CAPTURING` or `STEP3_CAPTURING` and update their input `ScanPhase` objects to use `BARCODE_LOCKED` / `STEP2_CONFIRMED` respectively (removing the now-nonexistent capturing phases), keeping the expected dot-state outputs the same shape as the merged case below.

- [ ] **Step 2: Add the failing test for `getActiveStepIndex`**

Append to `client/camera/components/__tests__/StepPill-utils.test.ts`:

```typescript
import { getActiveStepIndex } from "../StepPill-utils";

describe("getActiveStepIndex", () => {
  it("returns 0 while hunting or tracking a barcode", () => {
    expect(getActiveStepIndex({ type: "HUNTING" })).toBe(0);
    expect(
      getActiveStepIndex({
        type: "BARCODE_TRACKING",
        barcode: "1",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        frameCount: 1,
      }),
    ).toBe(0);
  });

  it("returns 1 once the barcode is locked (armed for nutrition, no separate arm step)", () => {
    expect(
      getActiveStepIndex({
        type: "BARCODE_LOCKED",
        barcode: "1",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).toBe(1);
  });

  it("returns 1 while reviewing the captured nutrition photo", () => {
    expect(
      getActiveStepIndex({
        type: "STEP2_REVIEWING",
        barcode: "1",
        imageUri: "x",
        ocrText: "",
      }),
    ).toBe(1);
  });

  it("returns 2 once nutrition is confirmed (armed for front, reviewing front, or complete)", () => {
    expect(
      getActiveStepIndex({
        type: "STEP2_CONFIRMED",
        barcode: "1",
        nutritionImageUri: "x",
        ocrText: "",
      }),
    ).toBe(2);
    expect(
      getActiveStepIndex({
        type: "STEP3_REVIEWING",
        barcode: "1",
        nutritionImageUri: "x",
        ocrText: "",
        frontImageUri: "y",
      }),
    ).toBe(2);
    expect(getActiveStepIndex({ type: "SESSION_COMPLETE", barcode: "1" })).toBe(
      2,
    );
  });

  it("returns null for phases that don't show the step pill", () => {
    expect(getActiveStepIndex({ type: "IDLE" })).toBeNull();
    expect(
      getActiveStepIndex({ type: "CLASSIFYING", imageUri: "x" }),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run client/camera/components/__tests__/StepPill-utils.test.ts`
Expected: FAIL — `getActiveStepIndex` is not exported from `../StepPill-utils`.

- [ ] **Step 4: Update `client/camera/components/StepPill-utils.ts`**

Full resulting file:

```typescript
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
      return stepIndex === 0 ? "active" : "idle";
    case "BARCODE_LOCKED":
    case "STEP2_REVIEWING":
      if (stepIndex === 0) return "done";
      if (stepIndex === 1) return "active";
      return "idle";
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
      if (stepIndex <= 1) return "done";
      return "active";
    case "SESSION_COMPLETE":
      return "done";
    default:
      return "idle";
  }
}

/**
 * Which step (0=Barcode, 1=Nutrition, 2=Front) the sliding highlight bar
 * should sit under. `BARCODE_LOCKED` already means "armed for nutrition" —
 * there's no separate arming phase — so it maps straight to 1, matching
 * `getStepDotState` marking step 0 done from that same phase.
 */
export function getActiveStepIndex(phase: ScanPhase): 0 | 1 | 2 | null {
  switch (phase.type) {
    case "HUNTING":
    case "BARCODE_TRACKING":
      return 0;
    case "BARCODE_LOCKED":
    case "STEP2_REVIEWING":
      return 1;
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
      return 2;
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run client/camera/components/__tests__/StepPill-utils.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/camera/components/StepPill-utils.ts client/camera/components/__tests__/StepPill-utils.test.ts
git commit -m "feat(scan): add getActiveStepIndex, update dot state for collapsed phases"
```

---

## Task 3: StepPill sliding indicator

**Files:**

- Modify: `client/camera/components/StepPill.tsx`

**Interfaces:**

- Consumes: `getActiveStepIndex` from Task 2.
- Produces: No prop/signature change to `StepPill` (`{ phase: ScanPhase }` stays the same) — purely a rendering addition, so no other file needs updating.

- [ ] **Step 1: Add the sliding bar to `client/camera/components/StepPill.tsx`**

This is a rendering-only addition with no pure-logic branch point to unit test in isolation (the underlying `getActiveStepIndex` logic is already covered by Task 2's tests); manual verification happens in Task 8. Apply this diff:

Add `getActiveStepIndex` to the existing `StepPill-utils` import:

```typescript
import {
  getStepDotState,
  getActiveStepIndex,
  shouldShowStepPill,
  type StepDotState,
} from "./StepPill-utils";
```

Replace the `StepPill` component body:

```typescript
const BAR_WIDTH = 64; // px — matches label column width incl. gap, tuned per STEP_LABELS

export function StepPill({ phase }: Props) {
  const opacity = useSharedValue(0);
  const barPosition = useSharedValue(0);
  const visible = shouldShowStepPill(phase);
  const activeIndex = getActiveStepIndex(phase);
  const { reducedMotion } = useAccessibility();

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible, opacity]);

  useEffect(() => {
    if (activeIndex === null) return;
    barPosition.value = reducedMotion
      ? activeIndex
      : withTiming(activeIndex, { duration: 350 });
  }, [activeIndex, barPosition, reducedMotion]);

  const pillAnimStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const barAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: barPosition.value * BAR_WIDTH }],
  }));

  return (
    <Animated.View style={[styles.pill, pillAnimStyle]} pointerEvents="none">
      <Animated.View style={[styles.slidingBar, barAnimStyle]} />
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && (
            <Connector
              precedingDotState={getStepDotState(phase, (i - 1) as 0 | 1 | 2)}
            />
          )}
          <StepDot
            label={label}
            state={getStepDotState(phase, i as 0 | 1 | 2)}
          />
        </React.Fragment>
      ))}
    </Animated.View>
  );
}
```

Add the `slidingBar` style to the `StyleSheet.create` call (alongside the existing `pill` style):

```typescript
  slidingBar: {
    position: "absolute",
    top: 4,
    left: 8,
    width: BAR_WIDTH - 8,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -- client/camera/components/StepPill.tsx` (or full `npx tsc --noEmit` — StepPill-specific errors should be gone; ScanScreen/ProductChip errors from Task 1 are still expected until Tasks 4/5)
Run: `npx expo lint client/camera/components/StepPill.tsx`
Expected: No new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add client/camera/components/StepPill.tsx
git commit -m "feat(scan): add sliding highlight bar to StepPill"
```

---

## Task 4: ProductChip — remove secondary "Add Photo" buttons, add auto-advancing review treatment

**Files:**

- Modify: `client/hooks/useAccessibility.ts`
- Modify: `client/hooks/__tests__/useAccessibility.test.ts`
- Modify: `client/camera/components/ProductChip.tsx`
- Modify: `client/camera/components/__tests__/ProductChip.a11y.test.tsx`
- Create: `client/camera/components/__tests__/ProductChip.test.tsx`

**Interfaces:**

- Produces: `useAccessibility()` now also returns `screenReaderEnabled: boolean`. `ProductChip`'s `Props` interface drops `onAddNutritionPhoto`/`onAddFrontPhoto` and gains `screenReaderEnabled?: boolean` (default `false`). The `barcode_lock`/`step2_confirmed` variants render a caption instead of a secondary button. The `step2_review`/`step3_review` variants render either the existing two-button treatment (when `screenReaderEnabled`) or a single tappable auto-advancing review card (when not).

- [ ] **Step 1: Write the failing test for `useAccessibility`'s new field**

Append to `client/hooks/__tests__/useAccessibility.test.ts` (inside the existing `describe` block, after the last `it`):

```typescript
it("returns screenReaderEnabled false by default before the native query resolves", () => {
  vi.spyOn(RN.AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(
    false,
  );
  vi.spyOn(RN.AccessibilityInfo, "addEventListener").mockReturnValue({
    remove: vi.fn(),
  } as unknown as ReturnType<typeof RN.AccessibilityInfo.addEventListener>);

  const { result } = renderHook(() => useAccessibility());

  expect(result.current.screenReaderEnabled).toBe(false);
});

it("updates screenReaderEnabled from the native query once it resolves", async () => {
  vi.spyOn(RN.AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(
    true,
  );
  vi.spyOn(RN.AccessibilityInfo, "addEventListener").mockReturnValue({
    remove: vi.fn(),
  } as unknown as ReturnType<typeof RN.AccessibilityInfo.addEventListener>);

  const { result } = renderHook(() => useAccessibility());

  await waitFor(() => {
    expect(result.current.screenReaderEnabled).toBe(true);
  });
});
```

Add the two new imports needed at the top of the file:

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import * as Reanimated from "react-native-reanimated";

import { useAccessibility } from "../useAccessibility";
```

(This replaces the existing `import { renderHook } from "@testing-library/react";` and `import * as Reanimated from "react-native-reanimated";` lines — add `waitFor` to the first import and add the new `import * as RN from "react-native";` line.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/hooks/__tests__/useAccessibility.test.ts`
Expected: FAIL — `result.current.screenReaderEnabled` is `undefined`, not `false`/`true`.

- [ ] **Step 3: Update `client/hooks/useAccessibility.ts`**

Full resulting file:

```typescript
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Hook for accessibility preferences.
 * Provides reduced motion status and other accessibility settings.
 */
export function useAccessibility() {
  const reducedMotion = useReducedMotion();
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => subscription.remove();
  }, []);

  return {
    /** Whether the user prefers reduced motion */
    reducedMotion: reducedMotion ?? false,
    /** Whether VoiceOver (iOS) or TalkBack (Android) is currently active */
    screenReaderEnabled,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/hooks/__tests__/useAccessibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for ProductChip's new rendering**

Create `client/camera/components/__tests__/ProductChip.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductChip } from "../ProductChip";
import type { ScanPhase } from "../../types/scan-phase";

const noop = () => {};

const handlers = {
  onConfirm: noop,
  onStepConfirmed: noop,
  onEditStep2: noop,
  onEditStep3: noop,
  onSmartPhotoConfirm: noop,
  onRetry: noop,
};

const barcodeLock: ScanPhase = {
  type: "BARCODE_LOCKED",
  barcode: "123",
  bounds: { x: 0.4, y: 0.45, width: 0.2, height: 0.1 },
};
const step2Confirmed: ScanPhase = {
  type: "STEP2_CONFIRMED",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
};
const step2Review: ScanPhase = {
  type: "STEP2_REVIEWING",
  barcode: "123",
  imageUri: "x",
  ocrText: "Calories 200",
};
const step3Review: ScanPhase = {
  type: "STEP3_REVIEWING",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
  frontImageUri: "y",
};

describe("ProductChip — barcode_lock / step2_confirmed have no secondary capture button", () => {
  it("barcode_lock renders exactly one button (the shutter, not this chip, captures the next photo)", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByText(/point at the nutrition facts/i),
    ).toBeTruthy();
  });

  it("step2_confirmed renders exactly one button", () => {
    render(<ProductChip phase={step2Confirmed} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/point at the front/i)).toBeTruthy();
  });
});

describe("ProductChip — step2_review / step3_review auto-advance treatment", () => {
  it("renders a single tappable review card (no separate Confirm/Edit buttons) when no screen reader is active", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/nutrition label captured/i)).toBeTruthy();
  });

  it("tapping the review card calls onEditStep2", () => {
    let called = false;
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        onEditStep2={() => {
          called = true;
        }}
        screenReaderEnabled={false}
      />,
    );
    screen.getByRole("button").click();
    expect(called).toBe(true);
  });

  it("falls back to the explicit Confirm/Edit buttons when a screen reader is active", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={true}
      />,
    );
    expect(screen.getByText("Looks right →")).toBeTruthy();
    expect(screen.getByText("Edit values")).toBeTruthy();
  });

  it("step3_review also gets the single tappable review card by default", () => {
    render(
      <ProductChip
        phase={step3Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/front label captured/i)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run client/camera/components/__tests__/ProductChip.test.tsx`
Expected: FAIL — current `ProductChip` still renders two buttons for `barcode_lock`/`step2_confirmed`/`step2_review`/`step3_review`, has no "Point at the..." captions, no "Nutrition label captured"/"Front label captured" text, and doesn't accept `screenReaderEnabled`.

- [ ] **Step 7: Update `client/camera/components/ProductChip.tsx`**

Remove `onAddNutritionPhoto`/`onAddFrontPhoto` from the `Props` interface and destructured params, add `screenReaderEnabled`, and replace the four affected variant blocks. Apply this diff against the file read in full earlier in this plan (the announce-effects, styles for `chip`/`productRow`/`btnPrimary`, and the `step3_review`/`session_complete`/`smart_photo`/`smart_error` variant blocks are UNCHANGED — only the pieces below move):

Change the `Props` interface:

```typescript
interface Props {
  phase: ScanPhase;
  onConfirm: () => void;
  onStepConfirmed: () => void;
  onEditStep2: () => void;
  onEditStep3: () => void;
  onSmartPhotoConfirm: () => void;
  onRetry: () => void;
  /**
   * True while VoiceOver/TalkBack is active. The auto-advancing review card
   * (step2_review/step3_review) falls back to explicit Confirm/Edit buttons
   * in this mode — the ~1s auto-advance timer in ScanScreen is suppressed for
   * screen-reader users (see docs/rules/accessibility.md and the design spec),
   * so this state needs its own explicit continue affordance instead.
   */
  screenReaderEnabled?: boolean;
  isSmartConfirming?: boolean;
  importantForAccessibility?: ViewProps["importantForAccessibility"];
}
```

Change the function signature's destructured params:

```typescript
export function ProductChip({
  phase,
  onConfirm,
  onStepConfirmed,
  onEditStep2,
  onEditStep3,
  onSmartPhotoConfirm,
  onRetry,
  importantForAccessibility,
  isSmartConfirming = false,
  screenReaderEnabled = false,
}: Props) {
```

Replace the `barcode_lock` variant block:

```typescript
      {variant === "barcode_lock" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onConfirm}
            accessibilityLabel="Confirm product"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <Text style={styles.caption}>
            Point at the Nutrition Facts panel to continue.
          </Text>
        </>
      )}
```

Replace the `step2_review` variant block:

```typescript
      {variant === "step2_review" &&
        (screenReaderEnabled ? (
          <>
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={onStepConfirmed}
              accessibilityLabel="Confirm nutrition values"
              accessibilityRole="button"
            >
              <Text style={styles.btnPrimaryText}>Looks right →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={onEditStep2}
              accessibilityLabel="Edit nutrition values"
              accessibilityRole="button"
            >
              <Text style={styles.btnSecondaryText}>Edit values</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.reviewCard}
            onPress={onEditStep2}
            accessibilityLabel="Nutrition label captured. Double tap to edit."
            accessibilityRole="button"
          >
            <View style={styles.reviewRow}>
              <View style={styles.reviewCheck}>
                <Text style={styles.reviewCheckText}>✓</Text>
              </View>
              <Text style={styles.reviewText}>Nutrition label captured</Text>
            </View>
          </TouchableOpacity>
        ))}
```

Replace the `step2_confirmed` variant block:

```typescript
      {variant === "step2_confirmed" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onConfirm}
            accessibilityLabel="Finish scan"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <Text style={styles.caption}>
            Optional: point at the front of the package to continue.
          </Text>
        </>
      )}
```

Replace the `step3_review` variant block:

```typescript
      {variant === "step3_review" &&
        (screenReaderEnabled ? (
          <>
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={onConfirm}
              accessibilityLabel="Confirm product complete"
              accessibilityRole="button"
            >
              <Text style={styles.btnPrimaryText}>Looks right →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={onEditStep3}
              accessibilityLabel="Edit front label values"
              accessibilityRole="button"
            >
              <Text style={styles.btnSecondaryText}>Edit values</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.reviewCard}
            onPress={onEditStep3}
            accessibilityLabel="Front label captured. Double tap to edit."
            accessibilityRole="button"
          >
            <View style={styles.reviewRow}>
              <View style={styles.reviewCheck}>
                <Text style={styles.reviewCheckText}>✓</Text>
              </View>
              <Text style={styles.reviewText}>Front label captured</Text>
            </View>
          </TouchableOpacity>
        ))}
```

Add these styles to the `StyleSheet.create` call (alongside the existing `btnLink`/`btnLinkText`):

```typescript
  caption: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  reviewCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reviewCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#22c55e", // hardcoded — matches DONE_COLOR in StepPill.tsx
    alignItems: "center",
    justifyContent: "center",
  },
  reviewCheckText: {
    color: "#fff", // hardcoded — camera overlay
    fontSize: 12,
    fontWeight: "700",
  },
  reviewText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "500",
  },
```

- [ ] **Step 8: Fix the now-stale `ProductChip.a11y.test.tsx` handlers object**

In `client/camera/components/__tests__/ProductChip.a11y.test.tsx`, remove the two obsolete entries from `handlers`:

```typescript
const handlers = {
  onConfirm: noop,
  onStepConfirmed: noop,
  onEditStep2: noop,
  onEditStep3: noop,
  onSmartPhotoConfirm: noop,
  onRetry: noop,
};
```

- [ ] **Step 9: Run both ProductChip test files to verify they pass**

Run: `npx vitest run client/camera/components/__tests__/ProductChip.test.tsx client/camera/components/__tests__/ProductChip.a11y.test.tsx`
Expected: PASS on both files.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: Remaining errors only in `client/screens/ScanScreen.tsx` (fixed in Task 5).

- [ ] **Step 11: Commit**

```bash
git add client/hooks/useAccessibility.ts client/hooks/__tests__/useAccessibility.test.ts client/camera/components/ProductChip.tsx client/camera/components/__tests__/ProductChip.a11y.test.tsx client/camera/components/__tests__/ProductChip.test.tsx
git commit -m "feat(scan): remove secondary capture buttons from ProductChip, add auto-advance review card"
```

---

## Task 5: Auto-advance timer hook, ScanScreen wiring, shutter phase updates, armed styling, scanCount fix

**Files:**

- Create: `client/camera/hooks/useAutoAdvanceTimer.ts`
- Create: `client/camera/hooks/__tests__/useAutoAdvanceTimer.test.ts`
- Modify: `client/screens/ScanScreen.tsx`
- Create: `client/screens/__tests__/ScanScreen.test.tsx`

**Interfaces:**

- Consumes: `screenReaderEnabled` from Task 4's `useAccessibility()`; the collapsed `ScanPhase`/`ScanAction` from Task 1.
- Produces: `useAutoAdvanceTimer(phase: ScanPhase, screenReaderEnabled: boolean, dispatch: (action: ScanAction) => void): void` — the auto-advance behavior extracted as its own hook so it's unit-testable without driving ScanScreen through a full camera capture sequence. Consumed by `ScanScreen.tsx`.

The timer logic is pulled out of `ScanScreen.tsx` into its own hook specifically so it can be tested directly with `renderHook` + fake timers and a controllable `phase` — `ScanScreen`'s internal `useReducer` state can't be driven into `STEP2_REVIEWING` from a render test without simulating the full native barcode-scanner → capture pipeline, which none of this repo's existing camera mocks do.

- [ ] **Step 1: Write the failing test for `useAutoAdvanceTimer`**

Create `client/camera/hooks/__tests__/useAutoAdvanceTimer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoAdvanceTimer } from "../useAutoAdvanceTimer";
import type { ScanPhase } from "../../types/scan-phase";

const step2Reviewing: ScanPhase = {
  type: "STEP2_REVIEWING",
  barcode: "1",
  imageUri: "x",
  ocrText: "",
};
const step3Reviewing: ScanPhase = {
  type: "STEP3_REVIEWING",
  barcode: "1",
  nutritionImageUri: "x",
  ocrText: "",
  frontImageUri: "y",
};
const barcodeLocked: ScanPhase = {
  type: "BARCODE_LOCKED",
  barcode: "1",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
};

describe("useAutoAdvanceTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches STEP_CONFIRMED ~1s after entering STEP2_REVIEWING", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(step2Reviewing, false, dispatch));

    expect(dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "STEP_CONFIRMED" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches CONFIRM_PRODUCT ~1s after entering STEP3_REVIEWING", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(step3Reviewing, false, dispatch));

    vi.advanceTimersByTime(1000);
    expect(dispatch).toHaveBeenCalledWith({ type: "CONFIRM_PRODUCT" });
  });

  it("does not schedule a timer for phases other than STEP2_REVIEWING/STEP3_REVIEWING", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(barcodeLocked, false, dispatch));

    vi.advanceTimersByTime(5000);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not schedule a timer when a screen reader is active", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(step2Reviewing, true, dispatch));

    vi.advanceTimersByTime(5000);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("cancels cleanly when the phase changes away before the timer fires (tapping to intervene)", () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ phase }) => useAutoAdvanceTimer(phase, false, dispatch),
      { initialProps: { phase: step2Reviewing } },
    );

    vi.advanceTimersByTime(500);
    rerender({ phase: barcodeLocked });
    vi.advanceTimersByTime(1000);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not double-fire when re-rendered with the same phase (rapid re-capture guard)", () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ phase }) => useAutoAdvanceTimer(phase, false, dispatch),
      { initialProps: { phase: step2Reviewing } },
    );

    vi.advanceTimersByTime(500);
    rerender({ phase: step2Reviewing });
    vi.advanceTimersByTime(500);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/camera/hooks/__tests__/useAutoAdvanceTimer.test.ts`
Expected: FAIL — `../useAutoAdvanceTimer` does not exist.

- [ ] **Step 3: Create `client/camera/hooks/useAutoAdvanceTimer.ts`**

```typescript
import { useEffect } from "react";
import type { ScanPhase, ScanAction } from "../types/scan-phase";

const AUTO_ADVANCE_MS = 1000;

/**
 * Auto-advances out of a step-review phase ~1s after capture, unless a screen
 * reader is active — the budget assumes sighted-user reaction speed and
 * doesn't hold for VoiceOver/TalkBack's hear-then-locate-then-act loop.
 * ProductChip falls back to explicit Confirm/Edit buttons in that mode.
 */
export function useAutoAdvanceTimer(
  phase: ScanPhase,
  screenReaderEnabled: boolean,
  dispatch: (action: ScanAction) => void,
): void {
  useEffect(() => {
    if (screenReaderEnabled) return;
    if (phase.type === "STEP2_REVIEWING") {
      const timer = setTimeout(() => {
        dispatch({ type: "STEP_CONFIRMED" });
      }, AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
    if (phase.type === "STEP3_REVIEWING") {
      const timer = setTimeout(() => {
        dispatch({ type: "CONFIRM_PRODUCT" });
      }, AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [phase.type, screenReaderEnabled, dispatch]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/camera/hooks/__tests__/useAutoAdvanceTimer.test.ts`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Write the failing smoke test for ScanScreen's wiring**

Create `client/screens/__tests__/ScanScreen.test.tsx`. This mocks the same native modules `CameraView.test.tsx` mocks (VisionCamera, barcode scanner) plus navigation/permissions, following this repo's established mocking style. It only proves the screen mounts cleanly with the new hook/prop wiring — the auto-advance behavior itself is covered by Step 1's hook test above, the state-machine contract by Task 1's reducer tests, and the shutter/chip button-count regression by Task 4's `ProductChip.test.tsx` (the correct unit boundary — it's a `ProductChip` rendering defect, not a `ScanScreen` one):

```typescript
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-native-vision-camera", () => ({
  Camera: vi.fn(() => React.createElement("div", { "data-testid": "camera" })),
  useCameraDevice: vi.fn(() => ({ id: "back", position: "back" })),
  usePhotoOutput: vi.fn(() => ({ capturePhotoToFile: vi.fn() })),
}));
vi.mock("react-native-vision-camera-barcode-scanner", () => ({
  useBarcodeScannerOutput: vi.fn(() => ({})),
}));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: {
    Tap: () => ({ onEnd: () => ({}) }),
    Pinch: () => ({ onStart: () => ({ onUpdate: () => ({}) }) }),
    Simultaneous: () => ({}),
  },
}));
vi.mock("@/camera/hooks/useCameraPermissions", () => ({
  useCameraPermissions: () => ({
    permission: { status: "granted" },
    requestPermission: vi.fn(),
  }),
}));
vi.mock("@react-navigation/native", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@react-navigation/native")>();
  return {
    ...actual,
    useNavigation: () => ({
      navigate: vi.fn(),
      goBack: vi.fn(),
      isFocused: () => true,
    }),
    useIsFocused: () => true,
    useRoute: () => ({ params: {} }),
  };
});
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumCamera: () => ({ isPremium: true, remainingScans: null }),
}));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    refreshScanCount: vi.fn(),
    features: {},
  }),
}));

import ScanScreen from "../ScanScreen";

describe("ScanScreen — mounts with the new auto-advance/gesture wiring", () => {
  it("renders the camera, reticle, and a live shutter button with no crash", () => {
    render(<ScanScreen />);
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run client/screens/__tests__/ScanScreen.test.tsx`
Expected: FAIL — `ScanScreen.tsx` still references the (now-removed) `onAddNutritionPhoto`/`onAddFrontPhoto` props on `<ProductChip>`, causing a TypeScript error that fails the Vitest transform step. (`CameraView.tsx` itself isn't touched until Task 7, so this failure is only about the `ProductChip` prop mismatch — the `react-native-gesture-handler` mock above is inert until then and just needs to already be in place so this test file doesn't need a second edit in Task 7.)

- [ ] **Step 7: Update `client/screens/ScanScreen.tsx`**

Apply these changes in place (the rest of the ~1003-line file is unchanged from what's shown earlier in this plan document):

Add the new hook import (alongside the other `@/camera` imports):

```typescript
import { useAutoAdvanceTimer } from "@/camera/hooks/useAutoAdvanceTimer";
```

Add `screenReaderEnabled` to the destructured `useAccessibility()` call:

```typescript
const { reducedMotion, screenReaderEnabled } = useAccessibility();
```

Add the hook call, placed after the existing "Navigate to NutritionDetail when session is complete" effect (after line 230's closing `}, [...]);`):

```typescript
// Navigating away to edit (onEditStep2/onEditStep3) sets isFocused false,
// which the existing "Reset when screen loses focus" effect above already
// turns into a RESET → IDLE dispatch — that phase-type change is what
// cancels this hook's pending timer (see useAutoAdvanceTimer's own cleanup),
// so no extra cancellation logic is needed here.
useAutoAdvanceTimer(scanPhase, screenReaderEnabled, dispatch);
```

Update `onShutterPress`'s guard clause (was `"STEP2_CAPTURING"`/`"STEP3_CAPTURING"`, now `"BARCODE_LOCKED"`/`"STEP2_CONFIRMED"`):

```typescript
  const onShutterPress = useCallback(async () => {
    const phase = scanPhaseRef.current;
    if (
      phase.type !== "BARCODE_LOCKED" &&
      phase.type !== "STEP2_CONFIRMED" &&
      phase.type !== "HUNTING"
    )
      return;
```

Update the two branches after the `HUNTING` block returns (was `phase.type === "STEP2_CAPTURING"` / the trailing `else`, now `phase.type === "BARCODE_LOCKED"` / `phase.type === "STEP2_CONFIRMED"`):

```typescript
if (phase.type === "BARCODE_LOCKED") {
  let ocrText = "";
  try {
    const ocrResult = await recognizeTextFromPhoto(photo.uri);
    ocrText = ocrResult.text ?? "";
  } catch (err) {
    logger.error(
      "[ScanScreen STEP2 OCR] recognition failed; proceeding with empty text",
      err,
    );
  }
  dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri, ocrText });
} else {
  // STEP2_CONFIRMED (front-label capture) — no OCR needed
  dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri });
}
```

Add a derived "armed" boolean right before the `return (` in the JSX section (after the `overlayA11y` declaration around line 521):

```typescript
const shutterArmed =
  scanPhase.type === "HUNTING" ||
  scanPhase.type === "BARCODE_LOCKED" ||
  scanPhase.type === "STEP2_CONFIRMED";
```

Update the shutter `Pressable` to apply the armed style, and remove the now-obsolete `onAddNutritionPhoto`/`onAddFrontPhoto` props from `<ProductChip>`, passing `screenReaderEnabled` instead:

```typescript
        <Pressable
          style={[styles.shutter, shutterArmed && styles.shutterArmed]}
          onPress={onShutterPress}
          accessibilityLabel="Take photo"
          accessibilityRole="button"
        />
```

```typescript
      {/* Product chip */}
      <ProductChip
        importantForAccessibility={overlayA11y.productChip}
        isSmartConfirming={isSmartConfirming}
        screenReaderEnabled={screenReaderEnabled}
        phase={scanPhase}
        onConfirm={() => dispatch({ type: "CONFIRM_PRODUCT" })}
        onStepConfirmed={() => dispatch({ type: "STEP_CONFIRMED" })}
        onEditStep2={() => {
```

_(The `onEditStep2`/`onEditStep3`/`onSmartPhotoConfirm`/`onRetry` props and their bodies below that point are UNCHANGED — only the `onAddNutritionPhoto`/`onAddFrontPhoto` lines are deleted from the props list.)_

Move the scan-count badge inside `topOverlay` (delete the standalone block at its old location after the "Bottom controls" section, and add it as a new child of the `topOverlay` View, after `<StepPill phase={scanPhase} />`):

```typescript
      {/* Top overlay */}
      <View
        style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}
        importantForAccessibility={overlayA11y.staticUI}
      >
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Close camera"
          accessibilityRole="button"
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <StepPill phase={scanPhase} />
        {!isPremium && remainingScans !== null && (
          <Text style={styles.scanCountText}>
            {remainingScans > 0
              ? `${remainingScans} scans remaining`
              : "Daily limit reached"}
          </Text>
        )}
      </View>
```

Delete the old standalone block (previously right after the "Bottom controls" `</View>` and before the `{showConfetti && (`):

```typescript
      {/* Scan count badge (free tier) */}
      {!isPremium && remainingScans !== null && (
        <View
          style={styles.scanCount}
          importantForAccessibility={overlayA11y.staticUI}
        >
          <Text style={styles.scanCountText}>
            {remainingScans > 0
              ? `${remainingScans} scans remaining`
              : "Daily limit reached"}
          </Text>
        </View>
      )}
```

In the `StyleSheet.create` call: remove the `scanCount` style entry entirely (no longer used — it was the standalone `position: absolute, top: 120` block), keep `scanCountText` but drop its now-redundant color tuning if desired (leave as-is, it still applies), and add a new `shutterArmed` style next to the existing `shutter` style:

```typescript
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FFF", // hardcoded — camera overlay
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.4)",
  },
  shutterArmed: {
    borderColor: "#FFD60A", // hardcoded — matches FocusRing's focus-ring yellow (Task 6)
    shadowColor: "#FFD60A",
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run client/screens/__tests__/ScanScreen.test.tsx`
Expected: PASS.

- [ ] **Step 9: Full typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors — this is the last file with pending errors from Task 1's type changes.

- [ ] **Step 10: Run the full existing camera test suite to confirm no regressions**

Run: `npx vitest run client/camera client/screens/__tests__/ScanScreen.test.tsx client/hooks/__tests__/useAccessibility.test.ts`
Expected: PASS across all files.

- [ ] **Step 11: Lint**

Run: `npx expo lint client/screens/ScanScreen.tsx`
Expected: No new errors.

- [ ] **Step 12: Commit**

```bash
git add client/camera/hooks/useAutoAdvanceTimer.ts client/camera/hooks/__tests__/useAutoAdvanceTimer.test.ts client/screens/ScanScreen.tsx client/screens/__tests__/ScanScreen.test.tsx
git commit -m "feat(scan): auto-advance timer hook, armed shutter styling, scanCount badge fix"
```

---

## Task 6: `useCameraFocusAndZoom` hook + `FocusRing`/`ZoomLabel` components

**Files:**

- Create: `client/camera/hooks/useCameraFocusAndZoom-utils.ts`
- Create: `client/camera/hooks/__tests__/useCameraFocusAndZoom-utils.test.ts`
- Create: `client/camera/hooks/useCameraFocusAndZoom.ts`
- Create: `client/camera/components/FocusRing.tsx`
- Create: `client/camera/components/ZoomLabel.tsx`

**Interfaces:**

- Produces: `clampZoom(value, min, max): number` (pure, worklet-safe). `useCameraFocusAndZoom({ cameraRef, device }): { zoom: SharedValue<number>, focusPoint: FocusPoint | null, zoomLabel: string | null, tapGesture, pinchGesture }` — consumed by Task 7's `CameraView.tsx`/`CameraView.ios.tsx`. `FocusRing({ point, reducedMotion }): JSX.Element | null` and `ZoomLabel({ label }): JSX.Element | null` — both consumed by Task 7.

- [ ] **Step 1: Write the failing test for the pure zoom-clamping helper**

Create `client/camera/hooks/__tests__/useCameraFocusAndZoom-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { clampZoom } from "../useCameraFocusAndZoom-utils";

describe("clampZoom", () => {
  it("returns the value unchanged when within range", () => {
    expect(clampZoom(2, 1, 5)).toBe(2);
  });

  it("clamps to the minimum when below range", () => {
    expect(clampZoom(0.5, 1, 5)).toBe(1);
  });

  it("clamps to the maximum when above range", () => {
    expect(clampZoom(10, 1, 5)).toBe(5);
  });

  it("handles min === max (single-zoom-level device)", () => {
    expect(clampZoom(3, 1, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/camera/hooks/__tests__/useCameraFocusAndZoom-utils.test.ts`
Expected: FAIL — `../useCameraFocusAndZoom-utils` does not exist.

- [ ] **Step 3: Create `client/camera/hooks/useCameraFocusAndZoom-utils.ts`**

```typescript
/**
 * Called from inside the pinch gesture's `.onUpdate` worklet
 * (`useCameraFocusAndZoom.ts`) — needs its own "worklet" directive or it
 * silently crashes release/OTA builds despite passing tsc/lint/tests.
 * See docs/rules/react-native.md and scripts/__tests__/worklet-directive-guard.test.ts.
 */
export function clampZoom(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/camera/hooks/__tests__/useCameraFocusAndZoom-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `client/camera/hooks/useCameraFocusAndZoom.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import type { CameraDevice, CameraRef } from "react-native-vision-camera";
import { clampZoom } from "./useCameraFocusAndZoom-utils";

export interface FocusPoint {
  x: number;
  y: number;
  key: number;
}

interface UseCameraFocusAndZoomOptions {
  cameraRef: React.RefObject<CameraRef | null>;
  device: CameraDevice | undefined;
}

/**
 * Tap-to-focus + pinch-to-zoom for VisionCamera v5. Custom gestures (not
 * `enableNativeTapToFocusGesture`/`enableNativeZoomGesture`) so the focus
 * ring's timing can be tied to the actual `focusTo()` promise instead of the
 * native gesture's silent (no visual feedback) behavior.
 */
export function useCameraFocusAndZoom({
  cameraRef,
  device,
}: UseCameraFocusAndZoomOptions) {
  const zoom = useSharedValue(device?.neutralZoom ?? 1);
  const zoomAtGestureStart = useSharedValue(1);
  const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);
  const focusKeyRef = useRef(0);
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);
  const zoomLabelHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFocus = useCallback(
    (x: number, y: number) => {
      focusKeyRef.current += 1;
      setFocusPoint({ x, y, key: focusKeyRef.current });
      cameraRef.current?.focusTo({ x, y }).catch(() => {
        // Devices without focus metering support reject — the ring still
        // shows for feedback; the camera falls back to continuous AF.
      });
    },
    [cameraRef],
  );

  // Bridged from the pinch worklet on every update via runOnJS — shows a live
  // "1.8x" readout during the gesture, fades out ~600ms after it stops
  // changing. Re-arms the hide timer on each call rather than debouncing, so
  // the label stays visible for the whole gesture and only starts its
  // fade-out countdown once the fingers actually stop moving.
  const showZoomLabel = useCallback((value: number) => {
    setZoomLabel(`${value.toFixed(1)}x`);
    if (zoomLabelHideTimer.current) clearTimeout(zoomLabelHideTimer.current);
    zoomLabelHideTimer.current = setTimeout(() => {
      setZoomLabel(null);
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomLabelHideTimer.current) clearTimeout(zoomLabelHideTimer.current);
    };
  }, []);

  const tapGesture = Gesture.Tap().onEnd((e) => {
    runOnJS(runFocus)(e.x, e.y);
  });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      zoomAtGestureStart.value = zoom.value;
    })
    .onUpdate((e) => {
      if (!device) return;
      zoom.value = clampZoom(
        zoomAtGestureStart.value * e.scale,
        device.minZoom,
        device.maxZoom,
      );
      runOnJS(showZoomLabel)(zoom.value);
    });

  return { zoom, focusPoint, zoomLabel, tapGesture, pinchGesture };
}
```

- [ ] **Step 6: Create `client/camera/components/FocusRing.tsx` and `client/camera/components/ZoomLabel.tsx`**

```typescript
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
} from "react-native-reanimated";
import type { FocusPoint } from "../hooks/useCameraFocusAndZoom";

interface Props {
  point: FocusPoint | null;
  reducedMotion: boolean;
}

const RING_SIZE = 72;

export function FocusRing({ point, reducedMotion }: Props) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1.3);

  useEffect(() => {
    if (!point) return;
    if (reducedMotion) {
      opacity.value = 1;
      scale.value = 1;
      const timeout = setTimeout(() => {
        opacity.value = 0;
      }, 600);
      return () => clearTimeout(timeout);
    }
    opacity.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(500, withTiming(0, { duration: 400 })),
    );
    scale.value = withTiming(1, { duration: 250 });
  }, [point, opacity, scale, reducedMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!point) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        animStyle,
        { left: point.x - RING_SIZE / 2, top: point.y - RING_SIZE / 2 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: "#FFD60A", // hardcoded — camera overlay, matches iOS native focus-ring yellow
  },
});
```

`client/camera/components/ZoomLabel.tsx`:

```typescript
import React from "react";
import { StyleSheet, Text } from "react-native";

interface Props {
  label: string | null;
}

/**
 * Positioned to visually align with the (otherwise-unused) spacer slot next
 * to the shutter in ScanScreen's bottom controls row, without CameraView
 * needing to know about ScanScreen's layout — see the design spec's "Pinch-
 * to-zoom" section.
 */
export function ZoomLabel({ label }: Props) {
  if (!label) return null;
  return (
    <Text style={styles.label} pointerEvents="none">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    position: "absolute",
    bottom: 92, // px — clears the 72px shutter + insets.bottom padding below it
    alignSelf: "center",
    color: "#FFF", // hardcoded — camera overlay
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 13,
    fontWeight: "600",
  },
});
```

- [ ] **Step 7: Typecheck and lint the new files**

Run: `npx tsc --noEmit`
Run: `npx expo lint client/camera/hooks/useCameraFocusAndZoom.ts client/camera/hooks/useCameraFocusAndZoom-utils.ts client/camera/components/FocusRing.tsx client/camera/components/ZoomLabel.tsx`
Expected: Zero errors (the hook and components aren't consumed anywhere yet, so no new type errors should appear elsewhere).

- [ ] **Step 8: Commit**

```bash
git add client/camera/hooks/useCameraFocusAndZoom.ts client/camera/hooks/useCameraFocusAndZoom-utils.ts client/camera/hooks/__tests__/useCameraFocusAndZoom-utils.test.ts client/camera/components/FocusRing.tsx client/camera/components/ZoomLabel.tsx
git commit -m "feat(scan): add tap-to-focus/pinch-to-zoom gesture hook and focus ring"
```

---

## Task 7: Wire tap-to-focus and pinch-to-zoom into both `CameraView` platform variants

**Files:**

- Modify: `client/camera/components/CameraView.tsx`
- Modify: `client/camera/components/CameraView.ios.tsx`

**Interfaces:**

- Consumes: `useCameraFocusAndZoom`, `FocusRing`, and `ZoomLabel` from Task 6.
- Produces: No `CameraViewProps` change — this is purely internal to both `CameraView` implementations, so `ScanScreen.tsx` (or any other consumer) needs zero changes.

- [ ] **Step 1: Update `client/camera/components/CameraView.tsx`**

Add the new imports (alongside the existing ones):

```typescript
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCameraFocusAndZoom } from "../hooks/useCameraFocusAndZoom";
import { FocusRing } from "./FocusRing";
import { ZoomLabel } from "./ZoomLabel";
```

Inside the component, after `const device = useCameraDevice(facing);` and before `const photoOutput = usePhotoOutput(...)`, add:

```typescript
const { reducedMotion } = useAccessibility();
const { zoom, focusPoint, zoomLabel, tapGesture, pinchGesture } =
  useCameraFocusAndZoom({ cameraRef, device });
const composedGesture = Gesture.Simultaneous(tapGesture, pinchGesture);
```

Replace the final `return` block (from `if (!device) return <CameraUnavailable />;` through the closing `);` of the `<Camera>` element):

```typescript
    if (!device) return <CameraUnavailable />;

    return (
      <GestureDetector gesture={composedGesture}>
        <View style={[StyleSheet.absoluteFill, style]}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive}
            outputs={outputs}
            zoom={zoom}
            torchMode={
              device.hasTorch ? (enableTorch ? "on" : "off") : undefined
            }
            onError={(error) => {
              logger.warn("[CameraView] Camera error:", error.message);
            }}
          />
          <FocusRing point={focusPoint} reducedMotion={reducedMotion} />
          <ZoomLabel label={zoomLabel} />
        </View>
      </GestureDetector>
    );
```

- [ ] **Step 2: Update `client/camera/components/CameraView.ios.tsx`**

Apply the identical change (same imports, same hook call placement after `const device = useCameraDevice(facing);`, same replaced return block) — the iOS variant's `<Camera>` props (`outputs`, `torchMode`, `onError`) are unaffected by this change, only `zoom` is added and the `GestureDetector`/`FocusRing` wrapping is applied, exactly matching the `CameraView.tsx` diff above.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Run the existing CameraView test and the ScanScreen smoke test to confirm no regression**

Run: `npx vitest run client/camera/components/__tests__/CameraView.test.tsx client/screens/__tests__/ScanScreen.test.tsx`
Expected: PASS on both — `CameraView.test.tsx` only exercises the no-device guard, and neither `GestureDetector` nor the new hook affects that path (the `device` check still short-circuits before the gesture wiring). `ScanScreen.test.tsx` (Task 5) already had the `react-native-gesture-handler` mock added in anticipation of this task, so it should now render end-to-end with the fully-wired `CameraView` underneath it and pass without further changes.

_(`react-native-gesture-handler` needs a mock added to `CameraView.test.tsx` if the existing mocks don't already stub it globally — check `client/test/setup.ts` first; if `GestureDetector`/`Gesture` aren't already globally mocked there, add `vi.mock("react-native-gesture-handler", () => ({ GestureDetector: ({ children }: { children: React.ReactNode }) => children, Gesture: { Tap: () => ({ onEnd: () => ({}) }), Pinch: () => ({ onStart: () => ({ onUpdate: () => ({}) }) }), Simultaneous: () => ({}) } }));` to the top of `CameraView.test.tsx` before this step, matching the existing `vi.mock` style in that file.)_

- [ ] **Step 5: Lint**

Run: `npx expo lint client/camera/components/CameraView.tsx client/camera/components/CameraView.ios.tsx`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add client/camera/components/CameraView.tsx client/camera/components/CameraView.ios.tsx client/camera/components/__tests__/CameraView.test.tsx
git commit -m "feat(scan): wire tap-to-focus and pinch-to-zoom into CameraView"
```

---

## Task 8: Full verification pass

**Files:** None modified — this task only runs checks.

**Interfaces:** N/A.

- [ ] **Step 1: Run the worklet-directive guard**

Run: `npx vitest run scripts/__tests__/worklet-directive-guard.test.ts`
Expected: PASS — specifically confirms `clampZoom` (called inside the pinch gesture's `.onUpdate` worklet in Task 6) is correctly recognized as directive-carrying and not flagged as an offender, and that no other new file in this plan introduced an undirected cross-module worklet call.

- [ ] **Step 2: Run the full unit test suite**

Run: `npx vitest run --exclude 'server/storage/__tests__/**'`
Expected: PASS — zero regressions across the whole client test suite.

- [ ] **Step 3: Full typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Full lint**

Run: `npx expo lint`
Expected: Zero errors/warnings on changed files.

- [ ] **Step 5: Manual verification (documented, not automatable in this environment)**

Per the spec's Testing Strategy, these require a physical device via OTA update (no dev-client build exists on this machine currently — see `project_ios_fmt_clang21_build_break` memory):

- Tap-to-focus: tap different points on the live camera preview, confirm the focus ring appears at the tap point and the image visibly refocuses.
- Pinch-to-zoom: pinch in/out, confirm smooth zoom tracking with no lag, that the "1.8x"-style zoom label appears during the gesture and fades out ~600ms after it stops, and that it still works correctly alongside live barcode detection.
- Full capture flow: scan a barcode, confirm the chip shows immediately with no secondary button, confirm the shutter captures the nutrition label directly, confirm the ~1s auto-advance to the front-label step, confirm "Looks Good" still works as an early-exit at each stage.
- StepPill sliding bar alignment (added during Task 3's review — flagged as unverifiable from a diff alone): confirm the bar visually lands centered under "Barcode", "Nutrition", and "Front" at each of the 3 steps, not offset toward one edge. `BAR_WIDTH = 64` in `StepPill.tsx` assumes three equal-width columns, but the three labels have different text widths ("Nutrition" is the longest); if the bar is visibly misaligned under any label, the fix is tuning that constant (or switching to per-label measured widths), not a source-level bug.
- `CameraView.ios.tsx` gesture wiring (added during Task 7's review — flagged as unverifiable from a diff alone): the tap-to-focus/pinch-to-zoom wiring in this file has zero executed test coverage — Vitest/Vite always resolves `../CameraView` imports to the non-`.ios` variant, so this file's correctness rests only on a verified-byte-identical diff against the tested sibling plus `tsc`/lint, never an actual render. On an iOS device specifically, confirm tap-to-focus and pinch-to-zoom both work correctly _and_ that they don't interfere with this file's adjacent-but-untouched AVFoundation object-scanning path (`useObjectOutput`) — the two features share the same `<Camera>`/`<GestureDetector>` tree, and a textual diff can't catch a genuinely iOS-specific runtime interaction.
- VoiceOver/TalkBack pass: enable a screen reader, confirm the review steps show the explicit Confirm/Edit buttons (no auto-advance timeout), and confirm the new `getChipAnnounceText` announcements for `barcode_lock`/`step2_confirmed` still read sensibly (unchanged strings, but confirm they still make sense without the removed secondary button being announced elsewhere).

- [ ] **Step 6: Update the spec's status note** (optional, if the user wants the paper trail closed)

No code change — this step is a reminder for whoever executes the plan to tell the user manual on-device verification (Step 5 above) is the one remaining gate before this can be considered fully done, since it can't be automated in this environment.
