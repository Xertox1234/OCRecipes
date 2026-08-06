import type { ScanPhase } from "../types/scan-phase";

export type StepDotState = "idle" | "active" | "done";

/**
 * Exhaustive over `ScanPhase["type"]`, no `default` clause — same rationale as
 * `getStepDotState` below: a `Set`-membership check with an implicit
 * true/false fallback is the same silent-swallow risk as a `default:` clause,
 * just spelled differently. A future `ScanPhase` addition must be listed here
 * explicitly or `tsc` fails.
 */
export function shouldShowStepPill(phase: ScanPhase): boolean {
  switch (phase.type) {
    case "IDLE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return false;
    case "HUNTING":
    case "BARCODE_TRACKING":
    case "BARCODE_LOCKED":
    case "LABEL_PROMPTED":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
      return true;
  }
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
    case "LABEL_PROMPTED":
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
    // Smart-scan phases never show the step pill (see shouldShowStepPill), so
    // their dot state is never rendered — kept as an explicit case, not a
    // fall-through, so a future ScanPhase addition is a tsc error here.
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return "idle";
  }
}
