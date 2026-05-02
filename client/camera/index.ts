// Types
export * from "./types";
export * from "./types/scan-phase";

// Hooks
export { useCameraPermissions } from "./hooks/useCameraPermissions";
export { useCamera } from "./hooks/useCamera";

// Utils
export { recognizeTextFromPhoto } from "./utils/recognizeTextFromPhoto";

// Components
export { CameraView } from "./components/CameraView";
export { CoachHint } from "./components/CoachHint";
export { ScanFlashOverlay } from "./components/ScanFlashOverlay";
export { ScanSonarRing } from "./components/ScanSonarRing";
export { StepPill } from "./components/StepPill";
export { ScanReticle } from "./components/ScanReticle";
export { ProductChip } from "./components/ProductChip";

// Reducers
export { scanPhaseReducer } from "./reducers/scan-phase-reducer";

// Component utils (for testing / external use)
export { getCoachMessage } from "./components/CoachHint-utils";
export {
  getStepDotState,
  shouldShowStepPill,
} from "./components/StepPill-utils";
export {
  getReticleTarget,
  getConfidenceFromPhase,
} from "./components/ScanReticle-utils";
export { getProductChipVariant } from "./components/ProductChip-utils";
