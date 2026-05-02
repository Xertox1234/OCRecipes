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
