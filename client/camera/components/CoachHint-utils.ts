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
    case "STEP2_CAPTURING":
      return "Frame the Nutrition Facts panel";
    case "STEP3_CAPTURING":
      return "Frame the front of the package";
    case "BARCODE_LOCKED":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return "";
  }
}
