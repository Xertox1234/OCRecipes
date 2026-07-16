// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

import ScanScreen from "../ScanScreen";

const {
  mockGoBack,
  mockCanGoBack,
  mockNavigate,
  mockReset,
  mockRouteParams,
  mockPermissionStatus,
  mockShortcutToSessionComplete,
  mockApiRequest,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockNavigate: vi.fn(),
  mockReset: vi.fn(),
  mockRouteParams: {
    value: undefined as
      | {
          mode?: "label" | "front-label";
          verifyBarcode?: string;
          returnAfterLog?: boolean;
        }
      | undefined,
  },
  mockPermissionStatus: {
    value: "granted" as "granted" | "denied" | "undetermined",
  },
  // Set to true only by the post-log-success tests: shortcuts the very first
  // CAMERA_READY dispatch straight to SESSION_COMPLETE so handleConfirmLog's
  // confirm-card precondition can be reached without driving the full
  // barcode-lock → ProductChip "Confirm product" flow (which has its own
  // dedicated coverage in scan-phase-reducer.test.ts / ProductChip.test.tsx).
  mockShortcutToSessionComplete: { value: false },
  mockApiRequest: vi.fn(),
}));

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
    permission: { status: mockPermissionStatus.value },
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
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    reset: mockReset,
    isFocused: () => true,
  }),
  useIsFocused: () => true,
  useRoute: () => ({ params: mockRouteParams.value }),
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
// Only handleConfirmLog (post-log-success close) reaches apiRequest; the
// other two safe-back-navigation call sites never touch the network.
vi.mock("@/lib/query-client", () => ({
  apiRequest: mockApiRequest,
}));
// Delegates to the real reducer for every action except the shortcut used by
// the post-log-success tests below — scan-phase-reducer.test.ts already
// covers the reducer's real transition logic directly, so this file doesn't
// need to re-derive the barcode-lock → confirm state machine to reach
// SESSION_COMPLETE.
vi.mock("@/camera/reducers/scan-phase-reducer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/camera/reducers/scan-phase-reducer")
    >();
  return {
    scanPhaseReducer: (
      state: Parameters<typeof actual.scanPhaseReducer>[0],
      action: Parameters<typeof actual.scanPhaseReducer>[1],
    ) => {
      if (
        mockShortcutToSessionComplete.value &&
        action.type === "CAMERA_READY"
      ) {
        return { type: "SESSION_COMPLETE" as const, barcode: "0000000000000" };
      }
      return actual.scanPhaseReducer(state, action);
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  mockRouteParams.value = undefined;
  mockPermissionStatus.value = "granted";
  mockShortcutToSessionComplete.value = false;
  mockApiRequest.mockImplementation(async (_method: string, url: string) => {
    if (url.startsWith("/api/nutrition/barcode/")) {
      return {
        json: async () => ({ productName: "Test Product", calories: 120 }),
      } as Response;
    }
    return { json: async () => ({}) } as Response;
  });
});

describe("ScanScreen — mounts with the new auto-advance/gesture wiring", () => {
  it("renders the camera, reticle, and a live shutter button with no crash", () => {
    renderComponent(<ScanScreen />);
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
  });
});

describe("ScanScreen — safe back navigation", () => {
  describe("permission-denied — Cancel and go back", () => {
    beforeEach(() => {
      mockPermissionStatus.value = "denied";
    });

    it("goes back normally when a back stack exists", () => {
      mockCanGoBack.mockReturnValue(true);

      renderComponent(<ScanScreen />);
      fireEvent.click(screen.getByLabelText("Cancel and go back"));

      expect(mockGoBack).toHaveBeenCalledOnce();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReset).not.toHaveBeenCalled();
    });

    it("falls back to Main when there is no back stack", () => {
      mockCanGoBack.mockReturnValue(false);

      renderComponent(<ScanScreen />);
      fireEvent.click(screen.getByLabelText("Cancel and go back"));

      expect(mockGoBack).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: "Main" }],
      });
    });
  });

  describe("Close camera (top overlay)", () => {
    it("goes back normally when a back stack exists", () => {
      mockCanGoBack.mockReturnValue(true);

      renderComponent(<ScanScreen />);
      fireEvent.click(screen.getByLabelText("Close camera"));

      expect(mockGoBack).toHaveBeenCalledOnce();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReset).not.toHaveBeenCalled();
    });

    it("falls back to Main when there is no back stack", () => {
      mockCanGoBack.mockReturnValue(false);

      renderComponent(<ScanScreen />);
      fireEvent.click(screen.getByLabelText("Close camera"));

      expect(mockGoBack).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: "Main" }],
      });
    });
  });

  describe("post-log-success close (handleConfirmLog)", () => {
    beforeEach(() => {
      mockRouteParams.value = { returnAfterLog: true };
      mockShortcutToSessionComplete.value = true;
    });

    it("goes back normally when a back stack exists", async () => {
      mockCanGoBack.mockReturnValue(true);

      renderComponent(<ScanScreen />);
      fireEvent.click(await screen.findByLabelText("Log It"));

      await waitFor(() => {
        expect(mockGoBack).toHaveBeenCalledOnce();
      });
      // The navigation call only fires after the log POST resolves inside
      // handleConfirmLog's try block — assert it actually happened, so a
      // regression that reordered or dropped the log call wouldn't slip
      // through on the navigation assertion alone.
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/scanned-items",
        expect.anything(),
      );
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockReset).not.toHaveBeenCalled();
    });

    it("falls back to Main when there is no back stack", async () => {
      mockCanGoBack.mockReturnValue(false);

      renderComponent(<ScanScreen />);
      fireEvent.click(await screen.findByLabelText("Log It"));

      await waitFor(() => {
        expect(mockReset).toHaveBeenCalledWith({
          index: 0,
          routes: [{ name: "Main" }],
        });
      });
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/scanned-items",
        expect.anything(),
      );
      expect(mockGoBack).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
