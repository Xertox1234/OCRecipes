// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

import ScanScreen from "../ScanScreen";
import { useBarcodeScannerOutput } from "react-native-vision-camera-barcode-scanner";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo } from "react-native";
import { uploadPhotoForAnalysis } from "@/lib/photo-upload";
import { parseFrontLabelFromOCR } from "@/lib/front-label-ocr-parser";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

const {
  mockGoBack,
  mockCanGoBack,
  mockNavigate,
  mockReset,
  mockNavigationObject,
  mockRouteParams,
  mockPermissionStatus,
  mockShortcutToSessionComplete,
  mockSessionCompleteOcrText,
  mockFeatures,
  mockRefreshScanCount,
  mockApiRequest,
  mockCapturePhotoToFile,
  mockRecognizeText,
  mockIsFocused,
  mockDeleteAsync,
  mockToastError,
} = vi.hoisted(() => {
  const mockGoBack = vi.fn();
  const mockCanGoBack = vi.fn();
  const mockNavigate = vi.fn();
  const mockReset = vi.fn();
  return {
    mockGoBack,
    mockCanGoBack,
    mockNavigate,
    mockReset,
    // A stable object identity across renders — the real useNavigation() from
    // React Navigation returns a memoized object, and the session-complete
    // navigate effect depends on `navigation` itself (not just `.navigate`).
    // A fresh object literal per useNavigation() call (the original shape of
    // this mock) would make that dependency "change" every render and re-fire
    // the effect, canceling its own setTimeout via cleanup before it elapses.
    mockNavigationObject: {
      navigate: mockNavigate,
      goBack: mockGoBack,
      canGoBack: mockCanGoBack,
      reset: mockReset,
      isFocused: (): boolean => true,
    },
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
    // Only read when mockShortcutToSessionComplete is true. `undefined` (the
    // default) reproduces a barcode-only session — the shortcut SESSION_COMPLETE
    // object omits the `ocrText` key entirely, same as the real reducer's
    // BARCODE_LOCKED→CONFIRM_PRODUCT branch (scan-phase-reducer.ts:47).
    mockSessionCompleteOcrText: { value: undefined as string | undefined },
    // Mutable so a test can grant a gated feature (e.g. receiptScanner) to
    // reach a smart-classification route that would otherwise resolve to
    // "blocked" — default `{}` matches every existing test's assumption of
    // no premium features.
    mockFeatures: { value: {} as Record<string, boolean> },
    // Stable across renders (unlike a fresh vi.fn() per usePremiumContext()
    // call) — mirrors the real PremiumContext, which memoizes refreshScanCount
    // via useCallback. The session-complete navigate effect depends on this
    // function reference; an unstable mock would re-fire the effect on every
    // render and cancel its own setTimeout via cleanup before it ever elapses.
    mockRefreshScanCount: vi.fn(),
    mockApiRequest: vi.fn(),
    // ONE stable fn, not a fresh `vi.fn()` per usePhotoOutput() call:
    // CameraView's useImperativeHandle has no dep array, so it recaptures
    // photoOutput on every render. A per-render capture fn makes takePicture()
    // resolve against whichever instance the last commit produced, and any
    // shutter test then fails on `Alert.alert("Capture failed")` instead of on
    // the behaviour under test.
    mockCapturePhotoToFile: vi.fn(),
    mockRecognizeText: vi.fn(),
    // Mutable so individual tests can simulate the screen losing focus
    // (blur) without a real navigation transition — default true matches
    // every existing test's assumption of a focused screen.
    mockIsFocused: { value: true },
    mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
    mockToastError: vi.fn(),
  };
});

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
  usePhotoOutput: vi.fn(() => ({
    capturePhotoToFile: mockCapturePhotoToFile,
  })),
}));
// The package is ALSO aliased to test/mocks/ in vitest.config.mts (it calls
// requireNativeModule() at module scope). That alias and this vi.mock compose —
// vi.mock replaces whatever the resolver returns — so the shutter tests below
// can drive real OCR text through recognizeTextFromPhoto. Same pattern as
// client/camera/utils/__tests__/recognizeTextFromPhoto.test.ts.
vi.mock("@infinitered/react-native-mlkit-text-recognition", () => ({
  recognizeText: mockRecognizeText,
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
  useNavigation: () => mockNavigationObject,
  useIsFocused: () => mockIsFocused.value,
  useRoute: () => ({ params: mockRouteParams.value }),
}));
// ScanScreen deletes abandoned capture files on reset/unmount — the real
// module hits a native module at import time under jsdom.
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsync,
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumCamera: () => ({ isPremium: true, remainingScans: null }),
}));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    refreshScanCount: mockRefreshScanCount,
    features: mockFeatures.value,
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
  useToast: () => ({ success: vi.fn(), error: mockToastError }),
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
        return mockSessionCompleteOcrText.value === undefined
          ? { type: "SESSION_COMPLETE" as const, barcode: "0000000000000" }
          : {
              type: "SESSION_COMPLETE" as const,
              barcode: "0000000000000",
              nutritionImageUri: "file:///nutrition-label.jpg",
              ocrText: mockSessionCompleteOcrText.value,
            };
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
  mockSessionCompleteOcrText.value = undefined;
  mockFeatures.value = {};
  mockIsFocused.value = true;
  mockNavigationObject.isFocused = () => true;
  // Re-seeded every test (clearAllMocks wipes history, not implementations, so
  // a per-test override would otherwise leak into the next test in this file).
  mockCapturePhotoToFile.mockResolvedValue({ filePath: "/label.jpg" });
  mockRecognizeText.mockResolvedValue({ text: "", blocks: [] });
  mockDeleteAsync.mockResolvedValue(undefined);
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

    // L5 (2026-09-23 front-end audit): handleConfirmLog's catch used to show
    // the same generic toast for every /api/scanned-items failure. Branch on
    // ApiError.code the same way NutritionDetail's log-to-database path does
    // (useNutritionLookup.ts onError), instead of leaving RATE_LIMITED
    // indistinguishable from any other failure.
    it("shows a rate-limit-specific message when the log request is throttled", async () => {
      mockCanGoBack.mockReturnValue(true);
      mockApiRequest.mockImplementation(
        async (_method: string, url: string) => {
          if (url === "/api/scanned-items") {
            throw new ApiError("Too many requests", ErrorCode.RATE_LIMITED);
          }
          if (url.startsWith("/api/nutrition/barcode/")) {
            return {
              json: async () => ({
                productName: "Test Product",
                calories: 120,
              }),
            } as Response;
          }
          return { json: async () => ({}) } as Response;
        },
      );

      renderComponent(<ScanScreen />);
      fireEvent.click(await screen.findByLabelText("Log It"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Too many requests. Please wait a moment and try again.",
        );
      });
      expect(mockGoBack).not.toHaveBeenCalled();
      expect(mockReset).not.toHaveBeenCalled();
    });

    it("shows the generic message for a non-rate-limit log failure", async () => {
      mockCanGoBack.mockReturnValue(true);
      mockApiRequest.mockImplementation(
        async (_method: string, url: string) => {
          if (url === "/api/scanned-items") {
            throw new Error("boom");
          }
          if (url.startsWith("/api/nutrition/barcode/")) {
            return {
              json: async () => ({
                productName: "Test Product",
                calories: 120,
              }),
            } as Response;
          }
          return { json: async () => ({}) } as Response;
        },
      );

      renderComponent(<ScanScreen />);
      fireEvent.click(await screen.findByLabelText("Log It"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Failed to log item. Please try again.",
        );
      });
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

  // Guards the flex-trap: `styles.confirmFlagBadge` AND `styles.confirmButtons`
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

  // Regression guard for the tier gate: topDisplayFlag can hold a NUTRITION
  // flag (pickTopDisplayFlag parity), and that must present as an informational
  // heads-up — polite live region, no allergen Warning haptic — never with
  // safety-grade salience. severity is deliberately "danger" (impossible from
  // today's producer, enforced consumer-side) so BOTH assertions discriminate
  // the tier === "safety" guard from the old severity-only check: pre-fix this
  // flag fired the Warning haptic and rendered assertive.
  it("does NOT fire the Warning haptic and uses a polite live region for a danger-severity nutrition flag", async () => {
    const nutritionFlag = {
      id: "nutrient:sugar",
      kind: "nutrient",
      severity: "danger",
      tier: "nutrition",
      title: "High in sugar",
    };
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Soda",
            calories: 150,
            flags: [nutritionFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });

    renderComponent(<ScanScreen />);

    const badge = await screen.findByLabelText(nutritionFlag.title);
    expect(badge.getAttribute("aria-live")).toBe("polite");
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith(
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

describe("ScanScreen — session-complete navigate forwards ocrText (Task 4)", () => {
  // Non-returnAfterLog path only — the setTimeout → navigate("NutritionDetail")
  // branch at ScanScreen.tsx:~256-262. returnAfterLog has its own coverage
  // above (post-log-success close) and never reaches this branch.
  beforeEach(() => {
    mockShortcutToSessionComplete.value = true;
  });

  it("forwards ocrText when SESSION_COMPLETE carries it (STEP2 label captured)", async () => {
    mockSessionCompleteOcrText.value = "Calories 210, Total Fat 8g";

    renderComponent(<ScanScreen />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("NutritionDetail", {
        barcode: "0000000000000",
        nutritionImageUri: "file:///nutrition-label.jpg",
        ocrText: "Calories 210, Total Fat 8g",
      });
    });
  });

  // The key must be ABSENT, not present-and-undefined. `toHaveBeenCalledWith`
  // treats the two as equal, so it cannot tell them apart — and the shape the
  // three-valued contract forbids (`ocrText: undefined` on the wire) is exactly
  // the one it would wave through. Assert key absence on the real call args.
  it("omits ocrText on a barcode-only session (no label photo)", async () => {
    renderComponent(<ScanScreen />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("NutritionDetail", {
        barcode: "0000000000000",
      });
    });

    const params = mockNavigate.mock.calls.find(
      (call) => call[0] === "NutritionDetail",
    )?.[1] as Record<string, unknown>;
    expect(params).toBeDefined();
    expect("ocrText" in params).toBe(false);
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

  // Regression (fix round 2): a MILD allergy maps to `severity: "info"` while
  // keeping `tier: "safety"` (server/services/scan-flags.ts SEVERITY_TO_FLAG).
  // The severity-based filter above (`f.severity !== "info"`) dropped this —
  // silencing the ONLY signal a mild-allergen match gets (no haptic fires for
  // mild; that's `pickTopSafetyFlag`'s "danger"-only gate). The chip must
  // still surface it; only info-level NON-safety flags (Nutri-Score,
  // "Contains caffeine", etc.) should be dropped.
  const mildAllergenFlag = {
    id: "allergen:milk",
    kind: "allergen",
    tier: "safety",
    severity: "info",
    title: "Contains Milk",
    allergenId: "milk",
  };

  it("still surfaces a MILD allergen flag (safety tier, info severity)", async () => {
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Yogurt Bar",
            calories: 150,
            flags: [mildAllergenFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });

    await driveBarcodeLock();

    expect(await screen.findByText("⚠ Contains Milk")).toBeTruthy();
  });
});

describe("ScanScreen — scan-lock chip ranks safety tier before severity (fix round 3)", () => {
  // Regression (fix round 3): a mild allergen (severity "info", tier
  // "safety") survives the info-level filter above, but the old computation
  // fed both surviving flags into `pickTopFlag`, which ranks by pure
  // SEVERITY (allergen tie-break only at EQUAL severity). A warn-level
  // nutrition flag ("High in sugar", severity "warn") therefore outranked
  // and DISPLACED the milder allergen match — the allergen dropped off the
  // chip entirely. A personal allergen must never be hidden behind a
  // universal nutrition heads-up: the chip must show the top SAFETY flag
  // whenever any safety flag is present, regardless of its severity
  // relative to a nutrition flag.
  const mildAllergenFlag = {
    id: "allergen:milk",
    kind: "allergen",
    tier: "safety",
    severity: "info",
    title: "Contains Milk",
    allergenId: "milk",
  };
  const warnSugarFlag = {
    id: "nutrient:sugar",
    kind: "nutrient",
    tier: "nutrition",
    severity: "warn",
    title: "High in sugar",
    nutrient: "sugar",
  };

  it("surfaces the mild allergen over a warn-level nutrition flag", async () => {
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Milk Sugar Bar",
            calories: 200,
            flags: [warnSugarFlag, mildAllergenFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });

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

describe("ScanScreen — the shutter captures from LABEL_PROMPTED (whole-branch review Critical)", () => {
  // LABEL_PROMPTED was a terminal dead-end: `onShutterPress` early-returned for
  // it, `onBarcodeScanned` ignores every phase but HUNTING/BARCODE_TRACKING,
  // BARCODE_LOST is BARCODE_TRACKING-only, and the chip (the sole dispatcher of
  // PROCEED_TO_LABEL *and* CONFIRM_PRODUCT) unmounts in this phase. Pressing
  // "Scan Nutrition Facts →" therefore stranded the user with only "Close
  // camera", after removing the barcode-only escape hatch a tap earlier.
  //
  // Neither the reducer test (which dispatches STEP_PHOTO_CAPTURED from
  // LABEL_PROMPTED directly, so the transition looks covered while being
  // unreachable in production) nor `tsc` (the guard was a string-comparison
  // chain, not an exhaustive switch) could see this. It has to be driven
  // through the real shutter binding.
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

  const proceedToLabelThenShoot = async () => {
    await driveBarcodeLock();

    fireEvent.click(await screen.findByLabelText("Scan Nutrition Facts →"));
    // Precondition, not decoration: the chip really is gone in LABEL_PROMPTED,
    // so the shutter is the ONLY remaining route forward.
    expect(screen.queryByLabelText("Scan Nutrition Facts →")).toBeNull();
    expect(screen.queryByLabelText("Use database data anyway")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });
  };

  it("advances to step 2 instead of silently no-op'ing the tap", async () => {
    await proceedToLabelThenShoot();

    // STEP2_CONFIRMED, reached via the 1s auto-advance out of STEP2_REVIEWING,
    // is the first post-capture phase no timer dissolves — so this assertion
    // can't race itself the way a STEP2_REVIEWING one would.
    expect(
      await screen.findByLabelText("Finish scan", {}, { timeout: 3000 }),
    ).toBeTruthy();
  });

  // The other half of the same defect class, at the real call site: in a
  // blocked phase the press must ANNOUNCE why it did nothing, not silently
  // return — the pure agreement test in scan-screen-utils.test.ts proves the
  // map is consistent but never exercises onShutterPress itself (review
  // finding 2026-08-17).
  it("announces the blocked reason on a shutter press in BARCODE_TRACKING, with the disabled state mirrored", async () => {
    const announceSpy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    announceSpy.mockClear();

    renderComponent(<ScanScreen />);
    const attach = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0];
    const handler = attach.onBarcodeScanned;
    expect(handler).toBeDefined();
    // ONE frame: FIRST_BARCODE_DETECTED → BARCODE_TRACKING, well short of the
    // lock threshold — the phase the original report was almost certainly in.
    await act(async () => {
      handler!([
        {
          rawValue: "0778918011332",
          format: "ean-13",
          boundingBox: { left: 0.3, top: 0.4, right: 0.7, bottom: 0.6 },
        },
      ] as Parameters<NonNullable<typeof handler>>[0]);
    });

    const shutter = screen.getByLabelText("Take photo");
    // The state mirror: same source as the visual glow.
    expect(shutter.getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      fireEvent.click(shutter);
    });
    expect(announceSpy).toHaveBeenCalledWith(
      "Scanning the barcode automatically. No photo needed.",
    );
    expect(mockCapturePhotoToFile).not.toHaveBeenCalled();
  });

  it("mirrors the armed state as enabled on arrival (HUNTING)", () => {
    renderComponent(<ScanScreen />);
    expect(
      screen.getByLabelText("Take photo").getAttribute("aria-disabled"),
    ).toBe("false");
  });

  // Negative control through the SAME armed-press flow the suite already
  // exercises (LABEL_PROMPTED): an armed press must never fire a blocked
  // announcement. Not driven through HUNTING — that route's smart-capture
  // continuation needs classification API mocks this control doesn't want.
  it("does not announce a blocked reason when the shutter is armed", async () => {
    const announceSpy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    announceSpy.mockClear();

    await proceedToLabelThenShoot();
    expect(announceSpy).not.toHaveBeenCalledWith(
      "Scanning the barcode automatically. No photo needed.",
    );
  });

  // Pins the trap in the obvious fix: admitting LABEL_PROMPTED to the capture
  // guard alone routes it down the no-OCR branch, `normalizeOcrText(undefined)`
  // returns `null`, and EVERY label photographed via the new primary path is
  // then recorded as "photographed but unreadable" — gating 100% of label scans
  // while looking fixed.
  it("carries the recognised OCR text through to NutritionDetail, not null", async () => {
    mockRecognizeText.mockResolvedValue({
      text: "Calories 210\nTotal Fat 8g",
      blocks: [],
    });

    await proceedToLabelThenShoot();

    fireEvent.click(
      await screen.findByLabelText("Finish scan", {}, { timeout: 3000 }),
    );

    await waitFor(
      () => {
        expect(mockNavigate).toHaveBeenCalledWith("NutritionDetail", {
          barcode: "0778918011332",
          nutritionImageUri: "file:///label.jpg",
          ocrText: "Calories 210\nTotal Fat 8g",
        });
      },
      { timeout: 3000 },
    );
  });
});

describe("ScanScreen — front-label mode forwards verifyBarcode to FrontLabelConfirm", () => {
  // The "Add product details" CTA (NutritionDetail), LabelAnalysis's CTA and
  // FrontLabelConfirm's own Retake all open Scan with
  // { mode: "front-label", verifyBarcode }. #46's capture-handler rewrite
  // dropped the branch that read verifyBarcode, so the capture fell into smart
  // photo classification and the barcode was lost. FrontLabelConfirm runs the
  // front-label upload itself when sessionId is null, so ScanScreen only has
  // to hand over the photo, the barcode and a local OCR seed.
  const BARCODE = "0778918011332";

  const shootInFrontLabelMode = async () => {
    mockRouteParams.value = { mode: "front-label", verifyBarcode: BARCODE };
    renderComponent(<ScanScreen />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });
  };

  it("navigates to FrontLabelConfirm with the barcode, seeded from on-device OCR", async () => {
    const ocrText = "ORGANIC VALLEY\nWhole Milk\n1 L\nUSDA Organic";
    mockRecognizeText.mockResolvedValue({ text: ocrText, blocks: [] });

    await shootInFrontLabelMode();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("FrontLabelConfirm", {
        imageUri: "file:///label.jpg",
        barcode: BARCODE,
        sessionId: null,
        data: parseFrontLabelFromOCR(ocrText),
      });
    });
    expect(vi.mocked(uploadPhotoForAnalysis)).not.toHaveBeenCalled();
  });

  it("still navigates with an empty seed when on-device OCR fails", async () => {
    mockRecognizeText.mockRejectedValue(new Error("mlkit unavailable"));

    await shootInFrontLabelMode();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("FrontLabelConfirm", {
        imageUri: "file:///label.jpg",
        barcode: BARCODE,
        sessionId: null,
        data: {
          brand: null,
          productName: null,
          netWeight: null,
          claims: [],
          confidence: 0,
        },
      });
    });
    expect(vi.mocked(uploadPhotoForAnalysis)).not.toHaveBeenCalled();
  });
});

describe("ScanScreen — label mode forwards verifyBarcode to LabelAnalysis", () => {
  // NutritionDetail's "Help verify this product" CTA opens Scan with
  // { mode: "label", verifyBarcode }. LabelAnalysis only submits a
  // verification (POST /api/verification/submit) when it receives
  // verificationMode + verifyBarcode. #46 dropped the forwarding, so every
  // verification label scan logged food instead.
  const BARCODE = "0778918011332";
  const OCR = "Nutrition Facts\nCalories 250";

  const shootInLabelMode = async (params: Record<string, unknown>) => {
    mockRecognizeText.mockResolvedValue({ text: OCR, blocks: [] });
    mockRouteParams.value = params;
    renderComponent(<ScanScreen />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });
  };

  it("hands the barcode to LabelAnalysis in verification mode", async () => {
    await shootInLabelMode({ mode: "label", verifyBarcode: BARCODE });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("LabelAnalysis", {
        imageUri: "file:///label.jpg",
        localOCRText: OCR,
        barcode: BARCODE,
        verificationMode: true,
        verifyBarcode: BARCODE,
      });
    });
    expect(vi.mocked(uploadPhotoForAnalysis)).not.toHaveBeenCalled();
  });

  it("keeps a plain label scan out of verification mode", async () => {
    await shootInLabelMode({ mode: "label" });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("LabelAnalysis", {
        imageUri: "file:///label.jpg",
        localOCRText: OCR,
      });
    });
  });
});

describe("ScanScreen — fetchProductInfo Warning haptic is gated on liveness (audit L1)", () => {
  const dangerFlag = {
    id: "allergen:tree_nuts",
    kind: "allergen",
    severity: "danger",
    tier: "safety",
    title: "Contains Tree Nuts",
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

  it("fires the Warning haptic for a danger flag while the screen is focused", async () => {
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return {
          json: async () => ({
            productName: "Trail Mix",
            calories: 200,
            flags: [dangerFlag],
          }),
        } as Response;
      }
      return { json: async () => ({}) } as Response;
    });

    await driveBarcodeLock();

    await waitFor(() => {
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Warning,
      );
    });
  });

  // Reproduces audit finding L1 (ScanScreen.tsx ~396-398): fetchProductInfo
  // fired the Warning haptic after its async fetch resolved with no check
  // that the user was still on Scan. Fails on main.
  it("does not fire the Warning haptic when the screen lost focus before the fetch resolved", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/nutrition/barcode/")) {
        return pending;
      }
      return { json: async () => ({}) } as Response;
    });

    await driveBarcodeLock();

    // The user leaves Scan while the barcode lookup is still in flight.
    mockNavigationObject.isFocused = () => false;

    await act(async () => {
      resolveFetch({
        json: async () => ({
          productName: "Trail Mix",
          calories: 200,
          flags: [dangerFlag],
        }),
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Control: the fetch really did resolve and dispatch PRODUCT_LOADED —
    // otherwise "not called" would be true for the wrong reason.
    expect(await screen.findByText("⚠ Contains Tree Nuts")).toBeTruthy();
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Warning,
    );
  });
});

describe("ScanScreen — onSmartPhotoConfirm's navigate case does not leak untracked destinations", () => {
  // has_barcode and grocery_receipt/restaurant_receipt route to screens whose
  // params never carry `imageUri` (ClassificationRoute in scan-screen-utils.ts).
  // onSmartPhotoConfirm used to call releaseTempUri(imageUri) unconditionally
  // before routing, which forgot the file from pendingTempUrisRef WITHOUT
  // deleting it — for these two outcomes nothing else ever deletes it either.
  // The fix leaves the URI tracked for these outcomes so the existing
  // blur-triggered abandon-cleanup (resetScan -> cleanupPendingUris) deletes
  // it once the navigate's own blur fires — proven below by simulating that
  // blur and asserting deleteAsync eventually runs.

  it("does not permanently leak the capture file when smart-classification routes to NutritionDetail (has_barcode)", async () => {
    vi.mocked(uploadPhotoForAnalysis).mockResolvedValueOnce({
      sessionId: null,
      intent: "auto",
      foods: [],
      overallConfidence: 0.9,
      needsFollowUp: false,
      followUpQuestions: [],
      contentType: "has_barcode",
      barcode: "0778918011332",
    });

    const { rerender } = renderComponent(<ScanScreen />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    const confirm = await screen.findByLabelText(
      "Confirm smart photo analysis",
    );
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("NutritionDetail", {
        barcode: "0778918011332",
      });
    });
    // Not yet deleted — ScanScreen hasn't blurred yet.
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    // Simulate the blur the real navigate causes (same pattern as the
    // existing "abandoned by leaving Scan" test below) — this is what must
    // eventually clean up the file, since NutritionDetail's params never
    // carried it.
    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
  });

  it("does not permanently leak the capture file when smart-classification routes to ReceiptCapture (grocery_receipt)", async () => {
    mockFeatures.value = { receiptScanner: true };
    vi.mocked(uploadPhotoForAnalysis).mockResolvedValueOnce({
      sessionId: null,
      intent: "auto",
      foods: [],
      overallConfidence: 0.9,
      needsFollowUp: false,
      followUpQuestions: [],
      contentType: "grocery_receipt",
    });

    const { rerender } = renderComponent(<ScanScreen />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    const confirm = await screen.findByLabelText(
      "Confirm smart photo analysis",
    );
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("ReceiptCapture");
    });
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
  });
});

describe("ScanScreen — abandoned capture files are deleted (audit L2)", () => {
  const classificationResult = {
    sessionId: null,
    intent: "auto" as const,
    foods: [],
    overallConfidence: 0.9,
    needsFollowUp: false,
    followUpQuestions: [],
    contentType: "prepared_meal" as const,
  };

  // Reproduces audit finding L2: capturePhotoToFile writes to the OS temp
  // dir and nothing ever deleted it. Fails on main (deleteAsync is never
  // imported/called by ScanScreen).
  it("deletes the captured photo file when a failed smart classification is retried", async () => {
    vi.mocked(uploadPhotoForAnalysis).mockRejectedValueOnce(
      new Error("classification failed"),
    );

    renderComponent(<ScanScreen />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    const retry = await screen.findByLabelText("Retry smart photo analysis");
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(retry);
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
  });

  // The other half of the Risk note: leaving Scan mid-classification (no
  // retry, no confirm) must still clean up — abandonment via blur, not just
  // via the retry button.
  it("deletes the captured photo file when the smart flow is abandoned by leaving Scan", async () => {
    vi.mocked(uploadPhotoForAnalysis).mockResolvedValueOnce(
      classificationResult,
    );

    const { rerender } = renderComponent(<ScanScreen />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    await screen.findByLabelText("Confirm smart photo analysis");
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
  });

  // Drives the real barcode-lock -> STEP2 capture -> confirm flow (the
  // mockShortcutToSessionComplete reducer override used below skips CAMERA_READY
  // straight to SESSION_COMPLETE, so it never runs trackTempUri — a real capture
  // is required for these two tests to actually exercise pendingTempUrisRef).
  const driveToStep2Reviewing = async () => {
    const rendered = renderComponent(<ScanScreen />);

    const firstAttach = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0];
    const firstHandler = firstAttach.onBarcodeScanned;
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

    fireEvent.click(await screen.findByLabelText("Scan Nutrition Facts →"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    return rendered;
  };

  // Risk guard: a photo forwarded to NutritionDetail must survive — the
  // SESSION_COMPLETE navigate releases it before firing, so the blur that
  // navigation causes must not also delete it.
  //
  // The original version of this test used mockShortcutToSessionComplete,
  // which jumps CAMERA_READY straight to SESSION_COMPLETE without ever
  // capturing a photo — trackTempUri never ran, so pendingTempUrisRef never
  // held "file:///label.jpg" and the "not deleted" assertion passed whether
  // or not the SESSION_COMPLETE effect's releaseTempUri calls existed
  // (mutation-checked: deleting them here still leaves this version green
  // unless the drive below is real). Driving a real capture makes this test
  // actually depend on the guard.
  it("does not delete the nutrition photo forwarded to NutritionDetail", async () => {
    const { rerender } = await driveToStep2Reviewing();

    fireEvent.click(
      await screen.findByLabelText("Finish scan", {}, { timeout: 3000 }),
    );

    await waitFor(
      () => {
        expect(mockNavigate).toHaveBeenCalledWith(
          "NutritionDetail",
          expect.objectContaining({
            nutritionImageUri: "file:///label.jpg",
          }),
        );
      },
      { timeout: 3000 },
    );
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    // The navigate above blurs ScanScreen — simulate that and confirm the
    // abandon-cleanup still doesn't delete the file NutritionDetail now owns.
    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    expect(mockDeleteAsync).not.toHaveBeenCalledWith(
      "file:///label.jpg",
      expect.anything(),
    );
  });

  // Positive control (the denominator for the test above): abandoning the
  // scan at STEP2_REVIEWING — before confirming — must still delete the file,
  // proving trackTempUri really did track it and the abandon-cleanup path is
  // live for this flow, not just for the smart-photo flow covered above.
  it("deletes the STEP2 photo when the two-step flow is abandoned before confirming", async () => {
    const { rerender } = await driveToStep2Reviewing();

    await screen.findByLabelText(
      "Nutrition label captured. Double tap to edit.",
    );
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
  });
});

describe("ScanScreen — onEditStep2/onEditStep3 release the transferred photo, not the whole phase", () => {
  const driveBarcodeLockAndProceed = async () => {
    const rendered = renderComponent(<ScanScreen />);

    const firstAttach = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0];
    const firstHandler = firstAttach.onBarcodeScanned;
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
    fireEvent.click(await screen.findByLabelText("Scan Nutrition Facts →"));

    return rendered;
  };

  // Zero coverage previously (PR #1055 review finding): onEditStep2 releases
  // the STEP2 photo (ownership transfers to LabelAnalysis) instead of leaving
  // it for the abandon-cleanup this navigate's own blur would otherwise run.
  it("onEditStep2 releases the photo instead of leaving it for abandon-cleanup", async () => {
    const { rerender } = await driveBarcodeLockAndProceed();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    fireEvent.click(
      await screen.findByLabelText(
        "Nutrition label captured. Double tap to edit.",
      ),
    );

    expect(mockNavigate).toHaveBeenCalledWith("LabelAnalysis", {
      imageUri: "file:///label.jpg",
    });

    // Simulate the blur this navigate causes — must NOT delete: ownership
    // transferred to LabelAnalysis, which owns its own cleanup.
    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    expect(mockDeleteAsync).not.toHaveBeenCalledWith(
      "file:///label.jpg",
      expect.anything(),
    );
  });

  // Zero coverage previously. onEditStep3 releases only frontImageUri (the
  // URI it knows transfers) — nutritionImageUri must stay pending so the
  // abandon-cleanup this navigate's blur triggers still deletes it. Distinct
  // mock paths per capture are required: mockCapturePhotoToFile resolving the
  // same path for both captures would dedupe them to one pendingTempUrisRef
  // entry and make this assertion vacuous.
  it("onEditStep3 releases only frontImageUri, leaving nutritionImageUri pending for abandon-cleanup", async () => {
    mockCapturePhotoToFile
      .mockResolvedValueOnce({ filePath: "/label.jpg" })
      .mockResolvedValueOnce({ filePath: "/front.jpg" });

    const { rerender } = await driveBarcodeLockAndProceed();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    // Auto-advance (1s) out of STEP2_REVIEWING into STEP2_CONFIRMED.
    await screen.findByLabelText("Finish scan", {}, { timeout: 3000 });

    // Front-of-package capture -> STEP3_REVIEWING.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });

    fireEvent.click(
      await screen.findByLabelText("Front label captured. Double tap to edit."),
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      "FrontLabelConfirm",
      expect.objectContaining({ imageUri: "file:///front.jpg" }),
    );

    mockIsFocused.value = false;
    await act(async () => {
      rerender(<ScanScreen />);
    });

    // frontImageUri was released — ownership transferred, must survive.
    expect(mockDeleteAsync).not.toHaveBeenCalledWith(
      "file:///front.jpg",
      expect.anything(),
    );
    // nutritionImageUri was never released here — abandon-cleanup deletes it.
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label.jpg", {
      idempotent: true,
    });
  });
});
