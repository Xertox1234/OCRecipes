// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

import ScanScreen from "../ScanScreen";

// react-native-confetti-cannon ships Flow/JSX source that Vite's transform
// cannot parse under jsdom (same class of problem as the native-only camera
// modules below) — stub it out. ScanScreen only renders it conditionally on
// `showConfetti`, so this mount test never needs its real behavior.
vi.mock("react-native-confetti-cannon", () => ({
  default: () => null,
}));
vi.mock("react-native-vision-camera", () => ({
  Camera: vi.fn(() => React.createElement("div", { "data-testid": "camera" })),
  useCameraDevice: vi.fn(() => ({ id: "back", position: "back" })),
  usePhotoOutput: vi.fn(() => ({ capturePhotoToFile: vi.fn() })),
}));
vi.mock("react-native-vision-camera-barcode-scanner", () => ({
  useBarcodeScannerOutput: vi.fn(() => ({})),
}));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: {
    Tap: () => ({ onEnd: () => ({}) }),
    Pinch: () => ({ onStart: () => ({ onUpdate: () => ({}) }) }),
    Simultaneous: () => ({}),
  },
}));
vi.mock("@/camera/hooks/useCameraPermissions", () => ({
  useCameraPermissions: () => ({
    permission: { status: "granted" },
    requestPermission: vi.fn(),
  }),
}));
// A bare factory (not `importOriginal`) — ScanScreen only consumes
// useNavigation/useIsFocused/useRoute as values plus the type-only RouteProp
// (erased at runtime), so no other real export is needed. `importOriginal`
// was tried first per the brief's draft but pulls in @react-navigation/native's
// full transitive dependency graph, which this jsdom pipeline cannot parse
// (`SyntaxError: Unexpected token 'typeof'` from deep inside a dependency) —
// reproduced in isolation outside ScanScreen, so it is not specific to this file.
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
    isFocused: () => true,
  }),
  useIsFocused: () => true,
  useRoute: () => ({ params: {} }),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumCamera: () => ({ isPremium: true, remainingScans: null }),
}));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    refreshScanCount: vi.fn(),
    features: {},
  }),
}));
// @/lib/photo-upload transitively imports expo-file-system, a native module
// that throws on import under jsdom (no test mock exists for it anywhere in
// the repo yet — no prior test renders a component that reaches this import).
// ScanScreen only references uploadPhotoForAnalysis by identity at module
// scope (it's called inside onShutterPress, not during render), so a stub is
// sufficient for this mount-only test.
vi.mock("@/lib/photo-upload", () => ({
  uploadPhotoForAnalysis: vi.fn(),
}));
// UpgradeModal pulls in @/lib/iap, which does a runtime `require("./mock-iap")`
// that Vite's ESM module graph can't resolve under jsdom. UpgradeModal has its
// own dedicated tests (UpgradeModal.test.ts, UpgradeModal.a11y.test.tsx) — it's
// a separate unit boundary, same as ProductChip — so a stub is appropriate here.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("ScanScreen — mounts with the new auto-advance/gesture wiring", () => {
  it("renders the camera, reticle, and a live shutter button with no crash", () => {
    renderComponent(<ScanScreen />);
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
  });
});
