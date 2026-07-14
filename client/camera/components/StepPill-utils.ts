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
