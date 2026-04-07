# Real-Time OCR Frame Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-device MLKit OCR to the camera's label mode so users get instant "text detected" feedback (corner glow) and immediate nutrition data preview, with OpenAI Vision as a background confirmation.

**Architecture:** VisionCamera frame processor plugin (`react-native-vision-camera-ocr-plus`) processes every 10th camera frame through MLKit text recognition. A debounced hook bridges OCR results to the JS thread, driving a corner glow animation on ScanScreen. On capture, cached OCR text is parsed by a regex-based nutrition extractor and passed to LabelAnalysisScreen for instant preview while the existing OpenAI pipeline runs in parallel.

**Tech Stack:** react-native-vision-camera-ocr-plus, react-native-vision-camera v4.7.3, react-native-reanimated 4, Vitest

**Design spec:** `docs/superpowers/specs/2026-04-07-realtime-ocr-frame-processor-design.md`

---

## File Map

| File                                                | Action | Responsibility                                                                         |
| --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `client/lib/nutrition-ocr-parser.ts`                | Create | Pure function: parse OCR text → structured nutrition data                              |
| `client/lib/__tests__/nutrition-ocr-parser.test.ts` | Create | Unit tests for the parser                                                              |
| `client/camera/hooks/useOCRDetection.ts`            | Create | Frame processor hook: wraps MLKit, debounces text detection, caches results            |
| `client/camera/types.ts`                            | Modify | Add `enableOCR`, `onTextDetected`, `onOCRResult` props to `CameraViewProps`            |
| `client/camera/components/CameraView.tsx`           | Modify | Integrate `useOCRDetection`, conditionally use frame processor instead of code scanner |
| `client/camera/index.ts`                            | Modify | Re-export `LocalNutritionData` type                                                    |
| `client/screens/ScanScreen.tsx`                     | Modify | Add corner glow animation, wire OCR callbacks, cache result, pass to LabelAnalysis     |
| `client/screens/LabelAnalysisScreen.tsx`            | Modify | Accept local OCR data, instant preview, background OpenAI merge                        |
| `client/navigation/RootStackNavigator.tsx`          | Modify | Add `localOCRText` to `LabelAnalysis` route params                                     |
| `package.json`                                      | Modify | Add `react-native-vision-camera-ocr-plus` dependency                                   |

---

### Task 1: Install `react-native-vision-camera-ocr-plus`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install react-native-vision-camera-ocr-plus
```

- [ ] **Step 2: Install iOS pods**

```bash
cd ios && pod install && cd ..
```

- [ ] **Step 3: Verify package installed correctly**

```bash
node -e "require('react-native-vision-camera-ocr-plus'); console.log('OK')"
```

Expected: `OK` (no errors)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json ios/Podfile.lock
git commit -m "feat: add react-native-vision-camera-ocr-plus dependency"
```

---

### Task 2: Nutrition OCR Parser — Tests

**Files:**

- Create: `client/lib/__tests__/nutrition-ocr-parser.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import {
  parseNutritionFromOCR,
  type LocalNutritionData,
} from "../nutrition-ocr-parser";

describe("parseNutritionFromOCR", () => {
  it("extracts all fields from a standard US nutrition label", () => {
    const text = `Nutrition Facts
Serving Size 1 cup (228g)
Servings Per Container 2
Calories 250
Total Fat 12g
  Saturated Fat 3g
  Trans Fat 0g
Cholesterol 30mg
Sodium 470mg
Total Carbohydrate 31g
  Dietary Fiber 0g
  Total Sugars 5g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(12);
    expect(result.saturatedFat).toBe(3);
    expect(result.transFat).toBe(0);
    expect(result.cholesterol).toBe(30);
    expect(result.sodium).toBe(470);
    expect(result.totalCarbs).toBe(31);
    expect(result.dietaryFiber).toBe(0);
    expect(result.totalSugars).toBe(5);
    expect(result.protein).toBe(5);
    expect(result.servingSize).toBe("1 cup (228g)");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("handles decimal values", () => {
    const text = `Calories 120
Total Fat 1.5g
Saturated Fat 0.5g
Trans Fat 0g
Protein 2.5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalFat).toBe(1.5);
    expect(result.saturatedFat).toBe(0.5);
    expect(result.protein).toBe(2.5);
  });

  it("handles common OCR misreads (O→0, l→1)", () => {
    const text = `Calories 25O
Total Fat l2g
Sodium 47Omg
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(12);
    expect(result.sodium).toBe(470);
  });

  it("returns null fields for missing data and low confidence", () => {
    const text = `Calories 200
Protein 10g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(200);
    expect(result.protein).toBe(10);
    expect(result.totalFat).toBeNull();
    expect(result.sodium).toBeNull();
    expect(result.totalCarbs).toBeNull();
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("returns all-null with zero confidence for non-nutrition text", () => {
    const text = "Hello world this is not a nutrition label";

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns all-null with zero confidence for empty string", () => {
    const result = parseNutritionFromOCR("");
    expect(result.confidence).toBe(0);
    expect(result.calories).toBeNull();
  });

  it("handles 'less than' values (e.g., <1g)", () => {
    const text = `Calories 50
Total Fat 0g
Trans Fat 0g
Cholesterol <5mg
Sodium 10mg
Total Carbohydrate 13g
  Dietary Fiber <1g
  Total Sugars 10g
Protein 0g`;

    const result = parseNutritionFromOCR(text);
    expect(result.cholesterol).toBe(5);
    expect(result.dietaryFiber).toBe(1);
  });

  it("handles values with percent daily value on same line", () => {
    const text = `Calories 140
Total Fat 8g 10%
  Saturated Fat 1g 5%
Sodium 200mg 9%
Total Carbohydrate 15g 5%
Protein 3g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalFat).toBe(8);
    expect(result.saturatedFat).toBe(1);
    expect(result.sodium).toBe(200);
    expect(result.totalCarbs).toBe(15);
  });

  it("handles 'Total Carb' and 'Total Carb.' abbreviations", () => {
    const text = `Calories 100
Total Carb. 20g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalCarbs).toBe(20);
  });

  it("handles serving size on same line as label", () => {
    const text = `Serving Size 2/3 cup (55g)
Calories 230`;

    const result = parseNutritionFromOCR(text);
    expect(result.servingSize).toBe("2/3 cup (55g)");
    expect(result.calories).toBe(230);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/lib/__tests__/nutrition-ocr-parser.test.ts`
Expected: FAIL — `Cannot find module '../nutrition-ocr-parser'`

---

### Task 3: Nutrition OCR Parser — Implementation

**Files:**

- Create: `client/lib/nutrition-ocr-parser.ts`

- [ ] **Step 1: Implement the parser**

```typescript
/**
 * Pure function parser that extracts structured nutrition data from OCR text.
 * Designed for US nutrition labels in English. Uses line-by-line regex matching
 * with common OCR misread correction.
 */

export interface LocalNutritionData {
  calories: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  totalCarbs: number | null;
  dietaryFiber: number | null;
  totalSugars: number | null;
  protein: number | null;
  servingSize: string | null;
  confidence: number;
}

/** Fix common OCR character misreads in numeric strings */
function fixOCRDigits(s: string): string {
  return s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5");
}

/** Extract a numeric value from a string, applying OCR correction */
function extractNumber(raw: string): number | null {
  const fixed = fixOCRDigits(raw.trim());
  const num = parseFloat(fixed);
  return isNaN(num) ? null : num;
}

interface FieldPattern {
  key: keyof Omit<LocalNutritionData, "servingSize" | "confidence">;
  pattern: RegExp;
}

const FIELD_PATTERNS: FieldPattern[] = [
  { key: "calories", pattern: /calories\s+<?(\S+)/i },
  { key: "totalFat", pattern: /total\s+fat\s+<?(\S+?)g/i },
  { key: "saturatedFat", pattern: /saturated\s+fat\s+<?(\S+?)g/i },
  { key: "transFat", pattern: /trans\s+fat\s+<?(\S+?)g/i },
  { key: "cholesterol", pattern: /cholesterol\s+<?(\S+?)mg/i },
  { key: "sodium", pattern: /sodium\s+<?(\S+?)mg/i },
  {
    key: "totalCarbs",
    pattern: /total\s+carb(?:ohydrate|s|\.?)?\s+<?(\S+?)g/i,
  },
  { key: "dietaryFiber", pattern: /dietary\s+fiber\s+<?(\S+?)g/i },
  { key: "totalSugars", pattern: /total\s+sugars?\s+<?(\S+?)g/i },
  { key: "protein", pattern: /protein\s+<?(\S+?)g/i },
];

const SERVING_SIZE_PATTERN = /serving\s+size\s+(.+)/i;

/** Total number of numeric fields used to calculate confidence */
const TOTAL_FIELDS = FIELD_PATTERNS.length;

export function parseNutritionFromOCR(text: string): LocalNutritionData {
  const result: LocalNutritionData = {
    calories: null,
    totalFat: null,
    saturatedFat: null,
    transFat: null,
    cholesterol: null,
    sodium: null,
    totalCarbs: null,
    dietaryFiber: null,
    totalSugars: null,
    protein: null,
    servingSize: null,
    confidence: 0,
  };

  if (!text.trim()) return result;

  // Extract serving size (free-form text, not numeric)
  const servingMatch = text.match(SERVING_SIZE_PATTERN);
  if (servingMatch) {
    // Trim trailing whitespace and any trailing numbers-only (servings per container)
    result.servingSize = servingMatch[1].trim();
  }

  // Extract numeric fields
  let extracted = 0;
  for (const { key, pattern } of FIELD_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = extractNumber(match[1]);
      if (value !== null) {
        result[key] = value;
        extracted++;
      }
    }
  }

  result.confidence = extracted / TOTAL_FIELDS;

  return result;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run client/lib/__tests__/nutrition-ocr-parser.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 3: Commit**

```bash
git add client/lib/nutrition-ocr-parser.ts client/lib/__tests__/nutrition-ocr-parser.test.ts
git commit -m "feat: add nutrition OCR parser with tests

Pure function that extracts structured nutrition data from OCR text.
Handles common OCR misreads, decimal values, and partial label data.
Outputs a confidence score based on field extraction ratio."
```

---

### Task 4: Camera Types — Add OCR Props

**Files:**

- Modify: `client/camera/types.ts`

- [ ] **Step 1: Add OCR-related props to CameraViewProps**

In `client/camera/types.ts`, add the import for the OCR library's `Text` type and extend `CameraViewProps`:

After the existing imports at the top of the file, add:

```typescript
import type { Text as OCRText } from "react-native-vision-camera-ocr-plus";
```

Add new props to `CameraViewProps` (after the `style` prop):

```typescript
  /** Enable on-device OCR via frame processor (label mode only).
   * Mutually exclusive with barcode scanning — only enable when barcodeTypes is empty. */
  enableOCR?: boolean;
  /** Called when OCR text detection state changes (text enters/exits viewfinder) */
  onTextDetected?: (detected: boolean) => void;
  /** Called with raw OCR result after each processed frame */
  onOCRResult?: (text: OCRText) => void;
```

Also re-export the `OCRText` type:

```typescript
export type { OCRText };
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to camera types (some unrelated errors may exist)

- [ ] **Step 3: Commit**

```bash
git add client/camera/types.ts
git commit -m "feat: add OCR props to CameraViewProps type"
```

---

### Task 5: useOCRDetection Hook

**Files:**

- Create: `client/camera/hooks/useOCRDetection.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useRef, useCallback, useEffect } from "react";
import {
  useTextRecognition,
  type Text as OCRText,
} from "react-native-vision-camera-ocr-plus";
import { useFrameProcessor } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import * as Haptics from "expo-haptics";
import type { ForwardedRef } from "react";

export interface UseOCRDetectionOptions {
  /** Whether OCR detection is active */
  enabled: boolean;
  /** Called when text detection state changes */
  onTextDetected?: (detected: boolean) => void;
  /** Called with raw OCR result after each processed frame */
  onOCRResult?: (text: OCRText) => void;
  /** Debounce ms before firing textDetected(false). Default: 500 */
  debounceMs?: number;
}

export interface UseOCRDetectionReturn {
  /** Frame processor to pass to <Camera frameProcessor={...}> */
  frameProcessor: ReturnType<typeof useFrameProcessor> | undefined;
  /** Most recent OCR result (cached for passing to LabelAnalysisScreen on capture) */
  latestOCRResult: React.RefObject<OCRText | null>;
}

export function useOCRDetection(
  options: UseOCRDetectionOptions,
): UseOCRDetectionReturn {
  const { enabled, onTextDetected, onOCRResult, debounceMs = 500 } = options;

  const latestOCRResult = useRef<OCRText | null>(null);
  const isTextDetectedRef = useRef(false);
  const hasHapticsRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset haptic flag when disabled (new capture session)
  useEffect(() => {
    if (!enabled) {
      hasHapticsRef.current = false;
      isTextDetectedRef.current = false;
      latestOCRResult.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    }
  }, [enabled]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const { scanText } = useTextRecognition({
    language: "latin",
    frameSkipThreshold: 10,
  });

  // JS-thread callback for OCR results from the worklet
  const handleOCRResult = useCallback(
    (result: OCRText) => {
      const hasText = result.resultText.trim().length > 0;

      latestOCRResult.current = hasText ? result : null;

      if (hasText) {
        onOCRResult?.(result);
      }

      if (hasText && !isTextDetectedRef.current) {
        // Transition: no text → text detected
        isTextDetectedRef.current = true;

        // Clear any pending "no text" debounce
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }

        onTextDetected?.(true);

        // Fire haptic once per session
        if (!hasHapticsRef.current) {
          hasHapticsRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      } else if (!hasText && isTextDetectedRef.current) {
        // Transition: text detected → no text (debounced)
        if (!debounceTimerRef.current) {
          debounceTimerRef.current = setTimeout(() => {
            isTextDetectedRef.current = false;
            debounceTimerRef.current = null;
            onTextDetected?.(false);
          }, debounceMs);
        }
      }
    },
    [onTextDetected, onOCRResult, debounceMs],
  );

  // Bridge from worklet to JS thread
  const runOnJS = Worklets.createRunInJsFn(handleOCRResult);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      const result = scanText(frame);
      runOnJS(result);
    },
    [scanText, runOnJS],
  );

  return {
    frameProcessor: enabled ? frameProcessor : undefined,
    latestOCRResult,
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "useOCRDetection" | head -5`
Expected: No type errors for this file (if any, fix them)

- [ ] **Step 3: Commit**

```bash
git add client/camera/hooks/useOCRDetection.ts
git commit -m "feat: add useOCRDetection hook for frame processor OCR

Wraps MLKit text recognition in a VisionCamera frame processor.
Debounces text detection state, fires haptic once per session,
and caches latest result for post-capture use."
```

---

### Task 6: CameraView Integration

**Files:**

- Modify: `client/camera/components/CameraView.tsx`

- [ ] **Step 1: Import the hook and update the component**

Add import at top of `client/camera/components/CameraView.tsx`:

```typescript
import { useOCRDetection } from "../hooks/useOCRDetection";
```

Update the `CameraView` component's destructured props to include the new OCR props (in the forwardRef callback parameter list, after `style`):

```typescript
      enableOCR = false,
      onTextDetected,
      onOCRResult,
```

Add the hook call inside the component, after the existing `codeScanner` setup:

```typescript
const { frameProcessor, latestOCRResult } = useOCRDetection({
  enabled: enableOCR && barcodeTypes.length === 0,
  onTextDetected,
  onOCRResult,
});
```

Update the `<Camera>` JSX to conditionally use frame processor. Replace the existing `<Camera>` return (the one with `codeScanner={codeScanner}`) with:

```typescript
    return (
      <Camera
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, style]}
        device={device}
        isActive={isActive}
        photo
        photoQualityBalance={mapQualityToPhotoQualityBalance(photoQuality)}
        {...(enableOCR && barcodeTypes.length === 0
          ? { frameProcessor }
          : { codeScanner })}
        torch={enableTorch ? "on" : "off"}
      />
    );
```

- [ ] **Step 2: Export latestOCRResult via the ref API**

Extend the `useImperativeHandle` to expose the latest OCR result. Add to the returned object:

```typescript
      getLatestOCRResult: () => latestOCRResult.current,
```

And update `CameraRef` in `client/camera/types.ts` to include:

```typescript
export interface CameraRef {
  takePicture(options?: PhotoOptions): Promise<PhotoResult | null>;
  /** Get the most recent OCR result from the frame processor (label mode only) */
  getLatestOCRResult?: () =>
    | import("react-native-vision-camera-ocr-plus").Text
    | null;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "CameraView\|cameraRef" | head -10`
Expected: No type errors

- [ ] **Step 4: Run existing camera tests**

Run: `npx vitest run client/camera/hooks/__tests__/`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add client/camera/components/CameraView.tsx client/camera/types.ts
git commit -m "feat: integrate OCR frame processor into CameraView

When enableOCR is true and barcodeTypes is empty (label mode),
CameraView uses a frame processor instead of the code scanner.
Exposes getLatestOCRResult() via the imperative ref API."
```

---

### Task 7: Update Camera Index Exports

**Files:**

- Modify: `client/camera/index.ts`

- [ ] **Step 1: Add exports**

Add to `client/camera/index.ts`:

```typescript
// OCR types
export type { LocalNutritionData } from "../lib/nutrition-ocr-parser";
export type { OCRText } from "./types";
```

- [ ] **Step 2: Commit**

```bash
git add client/camera/index.ts
git commit -m "feat: export OCR types from camera module"
```

---

### Task 8: ScanScreen — Corner Glow Animation

**Files:**

- Modify: `client/screens/ScanScreen.tsx`

- [ ] **Step 1: Add text detection state and glow shared value**

Add new state and imports. At the top, add to the reanimated imports:

```typescript
import { interpolateColor } from "react-native-reanimated";
```

Inside `ScanScreen()`, after the existing `scanSuccessScale` shared value:

```typescript
const cornerGlow = useSharedValue(0);
const [textDetected, setTextDetected] = useState(false);
```

- [ ] **Step 2: Add text detection callback**

After the `textDetected` state, add:

```typescript
const handleTextDetected = useCallback(
  (detected: boolean) => {
    setTextDetected(detected);
    if (reducedMotion) {
      cornerGlow.value = detected ? 1 : 0;
    } else {
      cornerGlow.value = detected
        ? withTiming(1, { duration: 300 })
        : withTiming(0, { duration: 500 });
    }
  },
  [cornerGlow, reducedMotion],
);
```

- [ ] **Step 3: Wire enableOCR and callbacks to CameraView**

Update the `<CameraView>` JSX to pass OCR props:

```typescript
      <CameraView
        ref={cameraRef}
        barcodeTypes={
          isLabelMode || isFrontLabelMode ? [] : availableBarcodeTypes
        }
        onBarcodeScanned={
          isLabelMode || isFrontLabelMode ? undefined : onBarcodeScanned
        }
        enableTorch={torch}
        facing="back"
        isActive={isFocused}
        photoQuality={
          isLabelMode || isFrontLabelMode
            ? 0.85
            : highQualityCapture
              ? 0.9
              : 0.5
        }
        enableOCR={isLabelMode}
        onTextDetected={isLabelMode ? handleTextDetected : undefined}
      />
```

- [ ] **Step 4: Create animated corner glow style**

Add a new animated style after the existing `cornerStyle`:

```typescript
const glowCornerStyle = useAnimatedStyle(() => ({
  opacity: cornerOpacity.value,
  shadowColor: "#4ade80",
  shadowRadius: cornerGlow.value * 8,
  shadowOpacity: cornerGlow.value * 0.6,
}));
```

Replace `cornerStyle` with `glowCornerStyle` on the reticle `AnimatedView`:

```typescript
          <AnimatedView
            style={[
              styles.reticle,
              glowCornerStyle,
              { width: frame.WIDTH, height: frame.HEIGHT },
            ]}
          >
```

- [ ] **Step 5: Add connecting lines between corners**

Add connecting line elements inside the reticle `AnimatedView`, after the four corner `<View>` elements:

```typescript
            {/* Connecting lines — visible when text detected */}
            <Animated.View
              style={[
                styles.connectingLineTop,
                { backgroundColor: theme.success, opacity: cornerGlow.value },
              ]}
            />
            <Animated.View
              style={[
                styles.connectingLineBottom,
                { backgroundColor: theme.success, opacity: cornerGlow.value },
              ]}
            />
```

Add the styles in the `StyleSheet.create` block:

```typescript
  connectingLineTop: {
    position: "absolute",
    top: 0,
    left: LABEL_FRAME.CORNER_SIZE,
    right: LABEL_FRAME.CORNER_SIZE,
    height: 2,
    borderRadius: 1,
  },
  connectingLineBottom: {
    position: "absolute",
    bottom: 0,
    left: LABEL_FRAME.CORNER_SIZE,
    right: LABEL_FRAME.CORNER_SIZE,
    height: 2,
    borderRadius: 1,
  },
```

- [ ] **Step 6: Pass cached OCR result to LabelAnalysisScreen on capture**

In `handleShutterPress`, update the label mode navigation to include OCR data. Find the `isLabelMode` branch inside `handleShutterPress` and update it:

```typescript
          } else if (isLabelMode) {
            // Get cached OCR result from the frame processor
            const ocrResult = cameraRef.current?.getLatestOCRResult?.();
            navigation.navigate("LabelAnalysis", {
              imageUri: photo.uri,
              barcode: verifyBarcode,
              verificationMode: !!verifyBarcode,
              verifyBarcode,
              localOCRText: ocrResult?.resultText ?? undefined,
            });
            if (!verifyBarcode) refreshScanCount();
```

- [ ] **Step 7: Commit**

```bash
git add client/screens/ScanScreen.tsx
git commit -m "feat: add corner glow animation and OCR wiring to ScanScreen

Corner brackets glow and gain connecting lines when the frame
processor detects text in label mode. Cached OCR text is passed
to LabelAnalysisScreen on capture for instant preview."
```

---

### Task 9: Update Route Params

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx`

- [ ] **Step 1: Add localOCRText to LabelAnalysis params**

In `client/navigation/RootStackNavigator.tsx`, update the `LabelAnalysis` entry in `RootStackParamList`:

```typescript
  LabelAnalysis: {
    imageUri: string;
    barcode?: string;
    verificationMode?: boolean;
    verifyBarcode?: string;
    /** Raw OCR text from frame processor for instant local parsing */
    localOCRText?: string;
  };
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "LabelAnalysis" | head -10`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/navigation/RootStackNavigator.tsx
git commit -m "feat: add localOCRText to LabelAnalysis route params"
```

---

### Task 10: LabelAnalysisScreen — Instant Preview with OpenAI Merge

**Files:**

- Modify: `client/screens/LabelAnalysisScreen.tsx`

- [ ] **Step 1: Import the parser**

Add at the top of `client/screens/LabelAnalysisScreen.tsx`:

```typescript
import {
  parseNutritionFromOCR,
  type LocalNutritionData,
} from "@/lib/nutrition-ocr-parser";
```

- [ ] **Step 2: Update RouteParams type**

```typescript
type RouteParams = {
  imageUri: string;
  barcode?: string;
  verificationMode?: boolean;
  verifyBarcode?: string;
  localOCRText?: string;
};
```

- [ ] **Step 3: Add local OCR parsing and data source tracking**

Inside the component, after the existing state declarations, add:

```typescript
const [dataSource, setDataSource] = useState<"local" | "ai" | null>(null);
const [showUpdatedToast, setShowUpdatedToast] = useState(false);
```

Replace the existing `useEffect` that calls `analyze()` with a version that handles local OCR preview:

```typescript
// Parse local OCR data for instant preview (if available)
useEffect(() => {
  if (route.params.localOCRText) {
    const localData = parseNutritionFromOCR(route.params.localOCRText);
    if (localData.confidence >= 0.6) {
      setLabelData(localDataToExtractionResult(localData));
      setDataSource("local");
      setIsAnalyzing(false);
    }
  }
}, [route.params.localOCRText]);

// Upload to OpenAI (always, even with local preview)
useEffect(() => {
  let cancelled = false;

  async function analyze() {
    try {
      const result = await uploadLabelForAnalysis(imageUri, barcode);
      if (cancelled) return;
      setSessionId(result.sessionId);

      if (dataSource === "local" && labelData) {
        // Compare local vs AI: if significantly different, replace
        const aiData = result.labelData;
        if (shouldReplaceWithAI(labelData, aiData)) {
          setLabelData(aiData);
          setDataSource("ai");
          setShowUpdatedToast(true);
          setTimeout(() => setShowUpdatedToast(false), 3000);
        } else {
          // AI confirms local data — just record the session ID
          setDataSource("ai");
        }
      } else {
        // No local preview or low confidence — use AI data directly
        setLabelData(result.labelData);
        setDataSource("ai");

        if (result.labelData.confidence < 0.3) {
          setError(
            "Could not read the label clearly. Try again with better lighting.",
          );
        }
      }
    } catch (err) {
      if (cancelled) return;
      // If we have local data, keep showing it; only set error if no data at all
      if (!labelData) {
        setError(
          err instanceof Error ? err.message : "Failed to analyze label",
        );
      }
    } finally {
      if (!cancelled) setIsAnalyzing(false);
    }
  }

  analyze();
  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
}, [imageUri, barcode]);
```

- [ ] **Step 4: Add helper functions**

Add these above the component function, after `buildNutrientRows`:

```typescript
/** Convert LocalNutritionData to LabelExtractionResult for display */
function localDataToExtractionResult(
  data: LocalNutritionData,
): LabelExtractionResult {
  return {
    servingSize: data.servingSize,
    servingsPerContainer: null,
    calories: data.calories,
    totalFat: data.totalFat,
    saturatedFat: data.saturatedFat,
    transFat: data.transFat,
    cholesterol: data.cholesterol,
    sodium: data.sodium,
    totalCarbs: data.totalCarbs,
    dietaryFiber: data.dietaryFiber,
    totalSugars: data.totalSugars,
    addedSugars: null,
    protein: data.protein,
    vitaminD: null,
    calcium: null,
    iron: null,
    potassium: null,
    confidence: data.confidence,
    productName: null,
  };
}

/** Check if AI data differs significantly from local OCR (>10% on any core field) */
function shouldReplaceWithAI(
  local: LabelExtractionResult,
  ai: LabelExtractionResult,
): boolean {
  const fields: (keyof LabelExtractionResult)[] = [
    "calories",
    "totalFat",
    "protein",
    "totalCarbs",
    "sodium",
  ];

  for (const field of fields) {
    const localVal = local[field];
    const aiVal = ai[field];
    if (typeof localVal !== "number" || typeof aiVal !== "number") continue;
    if (localVal === 0 && aiVal === 0) continue;
    const diff = Math.abs(localVal - aiVal);
    const base = Math.max(Math.abs(localVal), Math.abs(aiVal), 1);
    if (diff / base > 0.1) return true;
  }
  return false;
}
```

- [ ] **Step 5: Add the "Scanned locally" badge and "Updated" toast**

In the JSX, add a badge after the "Nutrition Facts" title inside the nutrition card:

```typescript
          <View style={styles.nutritionTitleRow}>
            <ThemedText type="h3" style={styles.nutritionTitle}>
              Nutrition Facts
            </ThemedText>
            {dataSource === "local" && (
              <View
                style={[
                  styles.sourceBadge,
                  { backgroundColor: withOpacity(theme.info, 0.12) },
                ]}
              >
                <Feather name="smartphone" size={12} color={theme.info} />
                <ThemedText
                  type="small"
                  style={{ color: theme.info, fontWeight: "600" }}
                >
                  Scanned locally
                </ThemedText>
              </View>
            )}
          </View>
```

Replace the existing `<ThemedText type="h3" style={styles.nutritionTitle}>` block with the above `nutritionTitleRow` version.

Add an "Updated with AI" toast above the bottom bar:

```typescript
      {showUpdatedToast && (
        <Animated.View
          entering={FadeInUp.duration(200)}
          style={[
            styles.updatedToast,
            { backgroundColor: withOpacity(theme.info, 0.12) },
          ]}
        >
          <Feather name="check-circle" size={14} color={theme.info} />
          <ThemedText type="small" style={{ color: theme.info }}>
            Updated with AI analysis
          </ThemedText>
        </Animated.View>
      )}
```

Add to the `styles` object:

```typescript
  nutritionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sourceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  updatedToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
  },
```

- [ ] **Step 6: Show inline progress indicator when AI is loading**

Add a small progress indicator beneath the nutrition card when we have local data but AI hasn't responded yet. After the nutrition `<Card>`:

```typescript
        {dataSource === "local" && !sessionId && (
          <View style={styles.aiProgressRow}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary }}
            >
              Verifying with AI...
            </ThemedText>
          </View>
        )}
```

Add style:

```typescript
  aiProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
```

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions)

- [ ] **Step 8: Commit**

```bash
git add client/screens/LabelAnalysisScreen.tsx
git commit -m "feat: instant nutrition preview from local OCR with AI merge

LabelAnalysisScreen shows nutrition data immediately when local OCR
text is available (confidence >= 0.6). OpenAI Vision runs in background
and silently confirms or replaces with a brief toast if values differ
by more than 10%."
```

---

### Task 11: Final Integration Test

**Files:** None (manual testing)

- [ ] **Step 1: Build the native app**

```bash
npx expo run:ios
```

Expected: Build succeeds with no errors. If Apple Silicon simulator fails with MLKit error, test on physical device instead.

- [ ] **Step 2: Run full test suite one more time**

```bash
npm run test:run
```

Expected: All tests pass

- [ ] **Step 3: Run lint and type check**

```bash
npm run lint && npm run check:types
```

Expected: No errors

- [ ] **Step 4: Manual testing checklist**

Test on device/simulator:

1. Open camera in **barcode mode** — verify barcode scanning still works normally, no frame processor active
2. Switch to **label mode** (navigate via `Scan` with `mode: "label"`) — verify corner brackets still pulse
3. Point camera at a nutrition label — verify corners glow brighter with connecting lines
4. Move camera away from label — verify glow fades after ~500ms
5. Tap shutter while aimed at label — verify LabelAnalysisScreen shows instant nutrition data
6. Wait for AI response — verify data is silently confirmed or toast appears if different
7. Test with **no label text** (point at blank surface) — verify normal loading behavior on LabelAnalysis
8. Test **gallery pick** in label mode — verify LabelAnalysisScreen shows normal loading (no local data)
9. Verify **reduced motion** — corners snap instead of animating, connecting lines appear without transition

- [ ] **Step 5: Commit any fixes**

If any fixes were needed during testing, commit them individually with descriptive messages.
