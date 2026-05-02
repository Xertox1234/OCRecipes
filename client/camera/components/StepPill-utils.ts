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
