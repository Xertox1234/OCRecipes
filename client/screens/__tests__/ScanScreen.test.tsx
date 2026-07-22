// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

import ScanScreen from "../ScanScreen";
import { useBarcodeScannerOutput } from "react-native-vision-camera-barcode-scanner";
import * as Haptics from "expo-haptics";

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

describe("ScanScreen — confirm-card safety badge (returnAfterLog)", () => {
  // Mirrors client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx
  // (commit 8892c990) for the confirm-card version of the same badge.
  const dangerFlag = {
    id: "allergen:tree_nuts",
    kind: "allergen",
    severity: "danger",
    tier: "safety",
    title: "Contains Tree Nuts",
    detail: "You listed a severe tree nut allergy",
  };
  const composedLabel = `${dangerFlag.title}. ${dangerFlag.detail}`;

  beforeEach(() => {
    // Reuses the "post-log-success close" shortcut above: drives straight to
    // SESSION_COMPLETE without any barcode-frame simulation.
    mockRouteParams.value = { returnAfterLog: true };
    mockShortcutToSessionComplete.value = true;
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Trail Mix",
            calories: 210,
            flags: [dangerFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });
  });

  // Guards the flex-trap: `styles.confirmSafetyFlag` AND `styles.confirmButtons`
  // are BOTH `flexDirection: "row"` siblings under `styles.confirmCard` (a
  // plain column). A badge accidentally nested inside the buttons row would
  // render squished beside Dismiss/Log It instead of as a full-width banner
  // above them — `getByLabelText` alone can't catch that. Walk UP from the
  // Log It button (not down from the container) so the badge's own row isn't
  // mistaken for the buttons row by a naive descending querySelector.
  it("renders the badge as a sibling ABOVE the confirm buttons row, not nested inside it", async () => {
    renderComponent(<ScanScreen />);

    const badge = await screen.findByLabelText(composedLabel);
    const logButton = screen.getByLabelText("Log It");
    const confirmButtonsRow = logButton.closest(
      '[style*="flex-direction: row"]',
    );

    expect(confirmButtonsRow).not.toBeNull();
    expect(confirmButtonsRow?.contains(badge)).toBe(false);
  });

  it("exposes exactly one accessible node with the composed title+detail label", async () => {
    renderComponent(<ScanScreen />);

    // This jsdom harness doesn't model RN's `accessible={true}` subtree
    // collapse (VoiceOver/TalkBack behavior), so it can't verify that
    // mechanism itself — same ceiling as the ProductChip precedent this
    // mirrors. What IS verifiable here: getByLabelText throws if the
    // composed label resolves to more than one element (a single match
    // proves no duplicate), and the icon/text children carry no separate
    // aria-label of their own — confirmed by the absence of any nested
    // [aria-label] below the wrapper.
    const badge = await screen.findByLabelText(composedLabel);
    expect(badge.querySelector("[aria-label]")).toBeNull();
  });

  it("keeps Log It enabled when a severe safety flag is present", async () => {
    renderComponent(<ScanScreen />);

    await screen.findByLabelText(composedLabel);
    const logButton = screen.getByLabelText("Log It") as HTMLButtonElement;
    expect(logButton.disabled).toBe(false);
  });

  it("fires a Warning notification haptic for a danger-severity flag", async () => {
    renderComponent(<ScanScreen />);

    await screen.findByLabelText(composedLabel);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Warning,
    );
  });
});

describe("ScanScreen — torch toggle accessibility", () => {
  it("exposes a switch with a static label and a checked state that flips on press", () => {
    renderComponent(<ScanScreen />);

    const torchButton = screen.getByLabelText("Flashlight");
    expect(torchButton.getAttribute("role")).toBe("switch");
    expect(torchButton.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(torchButton);

    // Same element, same static label — only the checked state flips.
    expect(screen.getByLabelText("Flashlight")).toBe(torchButton);
    expect(torchButton.getAttribute("aria-checked")).toBe("true");
  });
});

describe("ScanScreen — barcode lock wiring (stale-closure regression, PR #654)", () => {
  it("locks a barcode driven entirely through the callback captured on the FIRST render", async () => {
    // The native camera output can keep invoking the callback it captured at
    // attach time across React commits. The old code read `scanPhase` from the
    // render closure, so a first-render callback saw IDLE forever and never
    // accumulated lock frames. The fix reads scanPhaseRef.current (mirrored at
    // render time). This test drives ONLY the first-render callback: with the
    // closure bug it never dispatches anything (no product fetch); with the
    // ref read it must progress HUNTING → TRACKING → LOCKED and fetch the
    // product (fetchProductInfo fires exactly on BARCODE_LOCKED).
    renderComponent(<ScanScreen />);

    const firstAttach = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0];
    const firstHandler = firstAttach.onBarcodeScanned;
    expect(firstHandler).toBeDefined();

    const frame = [
      {
        rawValue: "0778918011332",
        format: "ean-13",
        boundingBox: { left: 0.3, top: 0.4, right: 0.7, bottom: 0.6 },
      },
    ] as Parameters<NonNullable<typeof firstHandler>>[0];

    // Sequential calls with an effect flush between each — mirrors real frame
    // cadence, where React commits between native callback invocations. Lock
    // needs 6 matching frames (frameCount/7 ≥ 0.85).
    for (let i = 0; i < 7; i++) {
      await act(async () => {
        firstHandler!(frame);
      });
    }

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        "/api/nutrition/barcode/0778918011332",
      );
    });
  });
});

describe("ScanScreen — barcode-lock chip shows the top flag (Task 14)", () => {
  // Same-severity allergen vs. universal/nutrient flag — exercises
  // pickTopFlag's tie-break-toward-allergen through the REAL fetchProductInfo
  // wiring (not just a directly-constructed phase, as in
  // ProductChip.topFlag.test.tsx), so a regression that dropped the `topFlag:
  // pickTopFlag(...)` line from the PRODUCT_LOADED dispatch would fail here.
  const nutrientWarn = {
    id: "nutrient:sugar",
    kind: "nutrient",
    severity: "warn",
    tier: "nutrition",
    title: "High in sugar",
  };
  const allergenWarn = {
    id: "allergen:milk",
    kind: "allergen",
    severity: "warn",
    tier: "safety",
    title: "Contains Milk",
  };

  beforeEach(() => {
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Energy Blast",
            calories: 110,
            flags: [nutrientWarn, allergenWarn],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });
  });

  it("surfaces the allergen flag on the scan-lock chip after a real barcode lock", async () => {
    renderComponent(<ScanScreen />);

    const firstAttach = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0];
    const firstHandler = firstAttach.onBarcodeScanned;
    expect(firstHandler).toBeDefined();

    const frame = [
      {
        rawValue: "0778918011332",
        format: "ean-13",
        boundingBox: { left: 0.3, top: 0.4, right: 0.7, bottom: 0.6 },
      },
    ] as Parameters<NonNullable<typeof firstHandler>>[0];

    for (let i = 0; i < 7; i++) {
      await act(async () => {
        firstHandler!(frame);
      });
    }

    expect(await screen.findByText("⚠ Contains Milk")).toBeTruthy();
    expect(screen.queryByText(/High in sugar/)).toBeNull();
  });
});

describe("ScanScreen — scan-lock chip filters info-level flags (final-review fix)", () => {
  // Reviewer-flagged blocker: `pickTopFlag` has no severity filter, so a
  // clean healthy product whose only flag is `nutriscore:a` (severity
  // "info") rendered "⚠ Nutri-Score A" with an assertive announce — a
  // warning glyph + interrupt on neutral/good info. fetchProductInfo now
  // filters out info-level flags before picking the chip's topFlag; warn/
  // danger flags (allergens, high sugar/sat-fat/sodium, etc.) are unaffected.
  const infoNutriscoreFlag = {
    id: "nutriscore:a",
    kind: "nutriscore",
    severity: "info",
    tier: "nutrition",
    title: "Nutri-Score A",
    grade: "a",
  };
  const warnSugarFlag = {
    id: "nutrient:sugar",
    kind: "nutrient",
    severity: "warn",
    tier: "nutrition",
    title: "High in sugar",
  };

  const driveBarcodeLock = async () => {
    renderComponent(<ScanScreen />);

    const firstAttach = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0];
    const firstHandler = firstAttach.onBarcodeScanned;
    expect(firstHandler).toBeDefined();

    const frame = [
      {
        rawValue: "0778918011332",
        format: "ean-13",
        boundingBox: { left: 0.3, top: 0.4, right: 0.7, bottom: 0.6 },
      },
    ] as Parameters<NonNullable<typeof firstHandler>>[0];

    for (let i = 0; i < 7; i++) {
      await act(async () => {
        firstHandler!(frame);
      });
    }
  };

  it("shows no topFlag badge when the only flag is info severity", async () => {
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Clean Snack",
            calories: 100,
            flags: [infoNutriscoreFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });

    await driveBarcodeLock();

    expect(await screen.findByText("Clean Snack")).toBeTruthy();
    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it("still surfaces a warn-level flag alongside an info-level one", async () => {
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Sugary Snack",
            calories: 250,
            flags: [infoNutriscoreFlag, warnSugarFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });

    await driveBarcodeLock();

    expect(await screen.findByText("⚠ High in sugar")).toBeTruthy();
    expect(screen.queryByText(/Nutri-Score/)).toBeNull();
  });
});
