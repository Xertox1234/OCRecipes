# Real-Time OCR Frame Processor Design

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Add on-device OCR via frame processor to camera label mode for instant text detection feedback and local nutrition extraction

## Problem

All text extraction (nutrition labels, menus, front-of-package) currently round-trips to OpenAI Vision. For clearly printed nutrition labels, this adds unnecessary latency (~2-4s) and API cost when on-device OCR could extract the data locally. Users also get no feedback about whether they're aimed at readable text until after capture.

## Solution

Add Google MLKit text recognition via `react-native-vision-camera-ocr-plus` as a VisionCamera frame processor plugin. This enables:

1. **Real-time "text detected" feedback** in label mode via corner glow animation
2. **Instant nutrition preview** on LabelAnalysisScreen using locally extracted data
3. **OpenAI as confirmation** — runs in background, merges/replaces if results differ significantly

## Decisions

| Decision           | Choice                                | Rationale                                                            |
| ------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| UX feedback style  | Passive (corner glow)                 | No new UI elements; existing corners communicate state. Simplest v1. |
| OpenAI interaction | Local preview, OpenAI confirms        | Instant results for user, accuracy backstop for edge cases           |
| Active scan modes  | Label mode only                       | Frame processors have CPU/battery cost; label mode is the clear win  |
| Visual indicator   | Corner glow + connecting lines        | Ambient feedback, no cognitive load, extends existing animation      |
| OCR library        | `react-native-vision-camera-ocr-plus` | Purpose-built frame processor plugin; native performance at 30fps    |

## Architecture

### Data Flow: Real-Time Detection

```
Camera Frame (30fps)
  | (every 10th frame via frameSkipThreshold)
  v
useFrameProcessor + scanText()
  |
  v
Text result -> Worklets.createRunInJsFn -> JS thread
  |
  v
useOCRDetection hook (debounces + evaluates)
  |
  v
textDetected: boolean -> ScanScreen
  |
  v
Corner glow animation (Reanimated shared value)
```

### Data Flow: Post-Capture

```
User taps shutter -> takePicture()
  |
  v
Pass cached OCR Text to LabelAnalysisScreen (via route params)
  |
  +---> PhotoRecognizer({ uri }) -- higher-res static OCR (fills gaps)
  |
  +---> uploadLabelForAnalysis() -- OpenAI Vision (background)
  |
  v
LabelAnalysisScreen shows instant preview from local data
  |
  v
When OpenAI returns: merge/replace if significantly different
```

### New Files

| File                                                | Purpose                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `client/camera/hooks/useOCRDetection.ts`            | Frame processor OCR hook — wraps `useTextRecognition` + `useFrameProcessor`, debounces text detection state, caches latest result |
| `client/lib/nutrition-ocr-parser.ts`                | Pure function: regex parser extracting structured nutrition data from OCR text                                                    |
| `client/lib/__tests__/nutrition-ocr-parser.test.ts` | Comprehensive test suite for parser (common labels, OCR misreads, partial data)                                                   |

### Modified Files

| File                                      | Changes                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `client/camera/components/CameraView.tsx` | Add frame processor when `enableOCR` is true and `barcodeTypes` is empty                         |
| `client/camera/types.ts`                  | Add `enableOCR`, `onTextDetected`, `onOCRResult` props                                           |
| `client/camera/index.ts`                  | Export `LocalNutritionData` type for consumers                                                   |
| `client/screens/ScanScreen.tsx`           | Wire OCR props to CameraView, add corner glow animation, cache OCR result, pass to LabelAnalysis |
| `client/screens/LabelAnalysisScreen.tsx`  | Accept `localOCRData` param, instant preview, background OpenAI merge                            |
| `package.json`                            | Add `react-native-vision-camera-ocr-plus` dependency                                             |

## Component Details

### CameraView Changes

New props on `CameraViewProps`:

```typescript
/** Enable on-device OCR via frame processor (label mode only) */
enableOCR?: boolean;
/** Called when OCR text detection state changes */
onTextDetected?: (detected: boolean) => void;
/** Called with raw OCR text after each processed frame */
onOCRResult?: (text: Text) => void;
```

Behavior:

- When `enableOCR` is true and `barcodeTypes` is empty: mount frame processor instead of code scanner
- VisionCamera constraint: `codeScanner` and `frameProcessor` are mutually exclusive on `<Camera>` — this works naturally since label mode already sets `barcodeTypes={[]}`
- `scanRegion` maps LABEL_FRAME dimensions to percentage-based coordinates
- `frameSkipThreshold: 10` (process every ~10th frame, yielding ~3fps OCR)

### useOCRDetection Hook (internal to CameraView)

```typescript
interface UseOCRDetectionOptions {
  enabled: boolean;
  onTextDetected?: (detected: boolean) => void;
  onOCRResult?: (text: Text) => void;
  /** Debounce before firing textDetected(false) after text disappears */
  debounceMs?: number; // default: 500
}

interface UseOCRDetectionReturn {
  frameProcessor: FrameProcessor;
  latestOCRResult: Text | null;
}
```

**Ownership:** This hook is used _inside_ `CameraView.tsx`, not by ScanScreen directly. `CameraView` calls the hook when `enableOCR` is true, passes the returned `frameProcessor` to `<Camera>`, and forwards `onTextDetected`/`onOCRResult` callbacks up to ScanScreen via props.

- Wraps `useTextRecognition({ language: 'latin', frameSkipThreshold: 10 })`
- Uses `Worklets.createRunInJsFn` to bridge OCR results from worklet to JS thread
- Debounces `onTextDetected(false)` by 500ms to avoid flicker when camera moves slightly
- Fires haptic (`ImpactFeedbackStyle.Light`) once on first text detection per session
- Caches `latestOCRResult` via ref for passing to LabelAnalysisScreen on capture

### Corner Glow Animation

New shared value `cornerGlow` (0-1) layered on existing corner animation:

- `textDetected(true)`: `withTiming(1, { duration: 300 })`
- `textDetected(false)`: `withTiming(0, { duration: 500 })` (slower fade-out)
- Drives: corner border brightness increase, `shadowColor`/`shadowRadius` on corners, connecting lines between corners at `opacity: cornerGlow`
- Existing `cornerOpacity` pulse continues running independently
- `reducedMotion`: snap instead of animate; connecting lines appear/disappear without transition
- Haptic: `ImpactFeedbackStyle.Light` on first `true` transition per capture session (not every frame)

### Nutrition OCR Parser

Pure function in `client/lib/nutrition-ocr-parser.ts`:

```typescript
interface LocalNutritionData {
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
  confidence: number; // 0-1: (fields extracted) / (total fields)
}

function parseNutritionFromOCR(text: string): LocalNutritionData;
```

Parsing strategy:

- Line-by-line regex matching: `Calories\s+(\d+)`, `Total Fat\s+(\d+\.?\d*)g`, etc.
- Common OCR misread correction: `O` -> `0`, `l` -> `1`, `S` -> `5` in numeric contexts
- Confidence = `fieldsExtracted / totalFields`. Threshold of 0.6 (6+ of 10 core fields) for "complete enough" preview

Scope limitations (v1):

- US nutrition label format only (English)
- No unit conversion
- No serving size math

### LabelAnalysisScreen Integration

New route param:

```typescript
localOCRData?: LocalNutritionData;
```

Three-phase UX:

1. **Instant preview** (0ms) — If `localOCRData` present and `confidence >= 0.6`, render nutrition table immediately with "Scanned locally" badge. Null fields show "—" not 0.
2. **Background upload** — `uploadLabelForAnalysis()` fires in parallel. Small inline progress indicator beneath table.
3. **Merge on arrival** — When OpenAI returns:
   - Local confidence >= 0.6: compare values within 10% tolerance. Match = dismiss loader silently. Differ = replace with OpenAI data + brief "Updated with AI analysis" toast.
   - Local confidence < 0.6 or no local data: replace entirely (current behavior).

**Post-capture static OCR:** `PhotoRecognizer({ uri })` runs on the captured photo (higher resolution than frames). If it fills null fields from the frame processor result, merge before OpenAI returns.

**Fallback:** Gallery picks and captures without prior text detection pass `localOCRData: undefined` — screen shows loading spinner until OpenAI returns, same as current behavior.

## Dependencies

### New Package

- `react-native-vision-camera-ocr-plus` — MLKit OCR frame processor plugin
  - Peer deps: `react-native-vision-camera` (already installed v4.7.3), `react-native-worklets-core` (already installed v1.6.2)
  - Supports VisionCamera v4+, React Native 0.76+
  - Requires iOS deployment target 16.0+

### iOS Build

- Requires `pod install` and full native rebuild (`npx expo run:ios`)
- Apple Silicon simulator: may need Rosetta for MLKit — test on physical device if simulator build fails

## Testing Strategy

- **Unit tests** for `nutrition-ocr-parser.ts`: common label formats, partial data, OCR misreads, edge cases (no text, non-nutrition text)
- **Unit tests** for `useOCRDetection` hook: debounce behavior, haptic firing once per session, callback invocation
- **Integration** on physical device: point camera at nutrition labels, verify corner glow feedback and instant preview accuracy
- Existing test suite must continue passing (pre-commit hooks enforce this)

## Future Enhancements (Not in Scope)

- Active preview (live text overlay in viewfinder)
- Auto-capture when complete label detected
- Front-label and barcode mode OCR
- Multi-language label support
- Post-capture static OCR via `@infinitered/react-native-mlkit-text-recognition` (session 2)
