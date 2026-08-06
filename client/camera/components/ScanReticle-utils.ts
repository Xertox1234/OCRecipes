// client/camera/components/ScanReticle-utils.ts
import type { ScanPhase } from "../types/scan-phase";

export const BARCODE_RETICLE = { width: 260, height: 160 } as const;
export const LABEL_RETICLE = { width: 200, height: 270 } as const;
// Shared with scan-screen-utils' lock decision — the reticle's confidence ring
// and the actual barcode-lock math must derive from the same frame budget.
export const LOCK_THRESHOLD_FRAMES = 7;

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
    case "BARCODE_LOCKED":
    case "LABEL_PROMPTED":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
      return { ...center, ...LABEL_RETICLE };
    // Every other phase — including the smart-scan phases, which render their
    // own overlays, not this reticle — keeps the barcode-shaped centered
    // target. Explicit cases, not a fall-through, so a future ScanPhase
    // addition is a tsc error here.
    case "IDLE":
    case "HUNTING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
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
    // Every phase from BARCODE_LOCKED onward is at or past a confident lock.
    // Explicit cases, not a fall-through, so a future ScanPhase addition is a
    // tsc error here.
    case "BARCODE_LOCKED":
    case "LABEL_PROMPTED":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return 1.0;
  }
}
