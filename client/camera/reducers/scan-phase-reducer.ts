import {
  MANUAL_ENTRY_BOUNDS,
  type ResumablePhase,
  type ScanPhase,
  type ScanAction,
} from "../types/scan-phase";

/**
 * Collapse every "the recognizer gave us nothing usable" shape — `undefined`,
 * `""`, whitespace-only — to a single `null`, and trim otherwise.
 *
 * Whitespace-only matters in practice: MLKit can return a stray newline for a
 * blurry or glare-washed panel, which is truthy and would sail past a
 * `ocrText ? …` guard as if it were real label text.
 */
function normalizeOcrText(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Copy the nutrition photo / OCR text forward only when present, so a skipped
 * nutrition step stays a skipped step (absent keys, not `undefined` values).
 */
function nutritionFields(source: {
  nutritionImageUri?: string;
  ocrText?: string | null;
}): { nutritionImageUri?: string; ocrText?: string | null } {
  return {
    ...(source.nutritionImageUri !== undefined && {
      nutritionImageUri: source.nutritionImageUri,
    }),
    ...(source.ocrText !== undefined && { ocrText: source.ocrText }),
  };
}

type LockBounds = typeof MANUAL_ENTRY_BOUNDS;

/**
 * Shared by BARCODE_LOCKED and MANUAL_BARCODE_ENTERED: a redo detour that finds
 * the same barcode again returns to the phase it left. Any other barcode is a
 * fresh lock that still carries the resume, so "Not this" can return to the
 * detour; committing to the new product (any forward action) drops it.
 */
function lockOrResume(
  barcode: string,
  bounds: LockBounds,
  resume: ResumablePhase | undefined,
): ScanPhase {
  if (resume && resume.barcode === barcode) return resume;
  return {
    type: "BARCODE_LOCKED",
    barcode,
    bounds,
    ...(resume && { resume }),
  };
}

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
        ...(state.resume && { resume: state.resume }),
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
      return lockOrResume(state.barcode, state.bounds, state.resume);

    case "MANUAL_BARCODE_ENTERED":
      if (state.type !== "HUNTING" && state.type !== "BARCODE_TRACKING")
        return state;
      return lockOrResume(action.barcode, MANUAL_ENTRY_BOUNDS, state.resume);

    case "RESCAN":
      if (state.type !== "BARCODE_LOCKED") return state;
      return state.resume
        ? { type: "HUNTING", resume: state.resume }
        : { type: "HUNTING" };

    case "REDO_STEP":
      if (state.type !== "LABEL_PROMPTED" && state.type !== "STEP2_CONFIRMED")
        return state;
      if (action.step === "barcode") return { type: "HUNTING", resume: state };
      if (state.type !== "STEP2_CONFIRMED") return state;
      return {
        type: "LABEL_PROMPTED",
        barcode: state.barcode,
        product: state.product,
      };

    case "SKIP_STEP":
      if (state.type === "LABEL_PROMPTED") {
        return {
          type: "STEP2_CONFIRMED",
          barcode: state.barcode,
          product: state.product,
        };
      }
      if (state.type === "STEP2_CONFIRMED") {
        return {
          type: "SESSION_COMPLETE",
          barcode: state.barcode,
          ...nutritionFields(state),
        };
      }
      return state;

    case "PRODUCT_LOADED":
      if (state.type !== "BARCODE_LOCKED" || state.barcode !== action.barcode)
        return state;
      return { ...state, product: action.product };

    case "BARCODE_LOST":
      if (state.type !== "BARCODE_TRACKING") return state;
      return state.resume
        ? { type: "HUNTING", resume: state.resume }
        : { type: "HUNTING" };

    case "CONFIRM_PRODUCT":
      if (state.type === "BARCODE_LOCKED") {
        return { type: "SESSION_COMPLETE", barcode: state.barcode };
      }
      if (state.type === "STEP2_CONFIRMED") {
        return {
          type: "SESSION_COMPLETE",
          barcode: state.barcode,
          ...nutritionFields(state),
        };
      }
      if (state.type === "STEP3_REVIEWING") {
        return {
          type: "SESSION_COMPLETE",
          barcode: state.barcode,
          ...nutritionFields(state),
          frontImageUri: state.frontImageUri,
        };
      }
      return state;

    case "PROCEED_TO_LABEL":
      if (state.type !== "BARCODE_LOCKED") return state;
      return {
        type: "LABEL_PROMPTED",
        barcode: state.barcode,
        product: state.product,
      };

    case "STEP_PHOTO_CAPTURED":
      // LABEL_PROMPTED is the normal route here now; BARCODE_LOCKED is retained
      // so a capture taken before the chip's primary button is pressed still
      // completes step 2 rather than being silently dropped.
      if (state.type === "BARCODE_LOCKED" || state.type === "LABEL_PROMPTED") {
        return {
          type: "STEP2_REVIEWING",
          barcode: state.barcode,
          product: state.product,
          imageUri: action.imageUri,
          // `null`, never `""`. Reaching here means the user photographed a
          // nutrition panel, so the only two outcomes are readable and
          // unreadable — and the old `?? ""` made the unreadable one
          // indistinguishable from the barcode-only path downstream.
          ocrText: normalizeOcrText(action.ocrText),
        };
      }
      if (state.type === "STEP2_CONFIRMED") {
        return {
          type: "STEP3_REVIEWING",
          barcode: state.barcode,
          product: state.product,
          ...nutritionFields(state),
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

    case "RETAKE_STEP":
      // Back to the camera for the same step; the barcode and any earlier
      // photo stay. The caller deletes the discarded photo.
      if (state.type === "STEP2_REVIEWING") {
        return {
          type: "LABEL_PROMPTED",
          barcode: state.barcode,
          product: state.product,
        };
      }
      if (state.type === "STEP3_REVIEWING") {
        return {
          type: "STEP2_CONFIRMED",
          barcode: state.barcode,
          product: state.product,
          ...nutritionFields(state),
        };
      }
      return state;

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
        // error is not surfaced — the visible chip text and getChipAnnounceText
        // both hardcode the smart_error copy and ignore phase.error. State-parity only.
        error: "unrecognized",
      };

    case "RESET":
      return { type: "IDLE" };

    default:
      return state;
  }
}
