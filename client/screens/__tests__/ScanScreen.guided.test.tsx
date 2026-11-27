// @vitest-environment jsdom
// The guided barcode flow (Barcode · Nutrition · Front) wired into ScanScreen:
// onboarding gating (tips carousel → example card → counts), the "?" sheet,
// typing the number, "Not this", the redo-then-different-product discard, and
// Skip. Camera mocking follows ScanScreen.test.tsx.
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";

import ScanScreen from "../ScanScreen";
import { useBarcodeScannerOutput } from "react-native-vision-camera-barcode-scanner";
import { ApiError } from "@/lib/api-error";
import { AccessibilityInfo } from "react-native";

const {
  mockNavigate,
  mockNavigationObject,
  mockRouteParams,
  mockApiRequest,
  mockCapturePhotoToFile,
  mockRecognizeText,
  mockDeleteAsync,
  mockToastInfo,
  tips,
} = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  return {
    mockNavigate,
    mockNavigationObject: {
      navigate: mockNavigate,
      goBack: vi.fn(),
      canGoBack: () => true,
      reset: vi.fn(),
      isFocused: (): boolean => true,
    },
    mockRouteParams: {
      value: undefined as Record<string, unknown> | undefined,
    },
    mockApiRequest: vi.fn(),
    mockCapturePhotoToFile: vi.fn(),
    mockRecognizeText: vi.fn(),
    mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
    mockToastInfo: vi.fn(),
    // In-memory stand-in for the feature-tips store.
    tips: {
      ready: true,
      seen: new Set<string>(),
      counts: {} as Record<string, number>,
      listeners: new Set<() => void>(),
      markTipSeen: vi.fn(),
      increment: vi.fn(),
    },
  };
});

vi.mock("@/hooks/useFeatureTip", () => ({ useMarkFeatureUsed: () => {} }));
vi.mock("@/lib/feature-tips-storage", () => ({
  isFeatureTipsReady: () => tips.ready,
  onFeatureTipsReady: (listener: () => void) => {
    tips.listeners.add(listener);
    return () => tips.listeners.delete(listener);
  },
  hasSeenTip: (id: string) => tips.seen.has(id),
  markTipSeen: async (id: string) => {
    tips.markTipSeen(id);
    tips.seen.add(id);
  },
  shouldShowExampleCard: (key: string) =>
    tips.ready ? (tips.counts[key] ?? 0) < 3 : null,
  incrementExampleViewCount: async (key: string) => {
    tips.increment(key);
    tips.counts[key] = (tips.counts[key] ?? 0) + 1;
    return tips.counts[key];
  },
}));
vi.mock("react-native-confetti-cannon", () => ({ default: () => null }));
vi.mock("react-native-vision-camera", () => ({
  Camera: vi.fn(() => React.createElement("div", { "data-testid": "camera" })),
  useCameraDevice: vi.fn(() => ({ id: "back", position: "back" })),
  usePhotoOutput: vi.fn(() => ({
    capturePhotoToFile: mockCapturePhotoToFile,
  })),
}));
vi.mock("@infinitered/react-native-mlkit-text-recognition", () => ({
  recognizeText: mockRecognizeText,
}));
vi.mock("react-native-vision-camera-barcode-scanner", () => ({
  useBarcodeScannerOutput: vi.fn(() => ({})),
}));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  useTapGesture: () => ({}),
  usePinchGesture: () => ({}),
  useSimultaneousGestures: () => ({}),
}));
vi.mock("@/camera/hooks/useCameraPermissions", () => ({
  useCameraPermissions: () => ({
    permission: { status: "granted" },
    requestPermission: vi.fn(),
  }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigationObject,
  useIsFocused: () => true,
  useRoute: () => ({ params: mockRouteParams.value }),
}));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: mockDeleteAsync }));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumCamera: () => ({ isPremium: true, remainingScans: null }),
}));
// Stable identities: the session-complete navigate effect depends on them,
// and a fresh object per render would cancel its own timer.
const premium = vi.hoisted(() => ({ refreshScanCount: vi.fn(), features: {} }));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => premium,
}));
vi.mock("@/lib/photo-upload", () => ({ uploadPhotoForAnalysis: vi.fn() }));
vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: (...args: unknown[]) => mockToastInfo(...args),
}));
vi.mock("@/context/ToastContext", () => ({ useToast: () => toast }));
vi.mock("@/lib/query-client", () => ({
  apiRequest: mockApiRequest,
  resolveImageUrl: (url: string | null | undefined) => url ?? null,
}));
// The sheets and the carousel are their own units (own tests). Stubs render
// only while shown, so "opens" is observable here.
vi.mock("@/camera/shell/HelpSheet", async () => {
  const { createElement } = await import("react");
  return {
    HelpSheet: (p: {
      visible: boolean;
      stepTitle: string;
      onShowExample: () => void;
      onClose: () => void;
    }) =>
      p.visible
        ? createElement(
            "div",
            { "data-testid": "help-sheet" },
            createElement("span", null, p.stepTitle),
            createElement(
              "button",
              { onClick: p.onShowExample },
              "Show the example again →",
            ),
          )
        : null,
  };
});
vi.mock("@/camera/shell/ManualBarcodeSheet", async () => {
  const { createElement } = await import("react");
  return {
    ManualBarcodeSheet: (p: {
      visible: boolean;
      onSubmit: (b: string) => void;
    }) =>
      p.visible
        ? createElement(
            "button",
            { onClick: () => p.onSubmit("0049000028911") },
            "Submit typed barcode",
          )
        : null,
  };
});
vi.mock("@/camera/shell/TipsCarousel", async () => {
  const { createElement } = await import("react");
  return {
    TipsCarousel: (p: { onDone: () => void }) =>
      createElement("button", { onClick: p.onDone }, "Scan now"),
  };
});

const BARCODE_A = "0778918011332";
const BARCODE_B = "5000159484695";

async function scanBarcode(code: string) {
  const handler = vi.mocked(useBarcodeScannerOutput).mock.calls[0][0]
    .onBarcodeScanned;
  const frame = [
    {
      rawValue: code,
      format: "ean-13",
      boundingBox: { left: 0.3, top: 0.4, right: 0.7, bottom: 0.6 },
    },
  ] as Parameters<NonNullable<typeof handler>>[0];
  for (let i = 0; i < 7; i++) {
    await act(async () => {
      handler!(frame);
    });
  }
}

/** Storage loaded, carousel already seen, example cards used up. */
function returningUser() {
  tips.seen.add("scan-tips-carousel");
  tips.counts = { barcode: 3, "barcode-nutrition": 3, "barcode-front": 3 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.value = undefined;
  tips.ready = true;
  tips.seen = new Set();
  tips.counts = {};
  tips.listeners.clear();
  mockCapturePhotoToFile.mockResolvedValue({ filePath: "/label.jpg" });
  mockRecognizeText.mockResolvedValue({ text: "", blocks: [] });
  mockDeleteAsync.mockResolvedValue(undefined);
  mockApiRequest.mockImplementation(async (_m: string, url: string) => {
    if (url.startsWith("/api/nutrition/barcode/")) {
      return {
        json: async () => ({ productName: "Oat Crunch", brandName: "Acme" }),
      } as Response;
    }
    return { json: async () => ({}) } as Response;
  });
});

describe("ScanScreen guided barcode flow — onboarding", () => {
  it("first-ever scan shows TipsCarousel before the example card", () => {
    renderComponent(<ScanScreen />);
    expect(screen.getByText("Scan now")).toBeTruthy();
    expect(screen.queryByLabelText("Got it")).toBeNull();
  });

  it('"Scan now" then shows the barcode ExampleCard', () => {
    renderComponent(<ScanScreen />);
    fireEvent.click(screen.getByText("Scan now"));
    expect(tips.markTipSeen).toHaveBeenCalledWith("scan-tips-carousel");
    expect(screen.queryByText("Scan now")).toBeNull();
    expect(screen.getByText("Scan the barcode")).toBeTruthy();
    expect(screen.getByLabelText("Got it")).toBeTruthy();
  });

  // A showing counts when the card first appears, so leaving with ✕ (no
  // "Got it") still spends one of the first 3.
  it("counts the barcode example card once, when it appears", async () => {
    tips.seen.add("scan-tips-carousel");
    renderComponent(<ScanScreen />);
    expect(screen.getByLabelText("Got it")).toBeTruthy();
    expect(tips.increment).toHaveBeenCalledTimes(1);
    expect(tips.increment).toHaveBeenCalledWith("barcode");

    fireEvent.click(screen.getByLabelText("Got it"));
    await waitFor(() => expect(screen.queryByLabelText("Got it")).toBeNull());
    expect(tips.increment).toHaveBeenCalledTimes(1);
  });

  it("keeps the 3rd showing up although counting it reaches the limit", () => {
    tips.seen.add("scan-tips-carousel");
    tips.counts = { barcode: 2 };
    renderComponent(<ScanScreen />);
    expect(tips.increment).toHaveBeenCalledWith("barcode");
    expect(tips.counts.barcode).toBe(3);
    expect(screen.getByLabelText("Got it")).toBeTruthy();
  });

  it("4th scan shows no example card", () => {
    returningUser();
    renderComponent(<ScanScreen />);
    expect(screen.queryByLabelText("Got it")).toBeNull();
    expect(screen.queryByText("Scan now")).toBeNull();
  });

  it("keeps the camera chrome from screen readers and the hint quiet while the example card is up", async () => {
    tips.seen.add("scan-tips-carousel");
    renderComponent(<ScanScreen />);
    expect(
      screen.getByTestId("scan-top-overlay").getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      screen.queryByText("Line the barcode up inside the frame"),
    ).toBeNull();

    fireEvent.click(screen.getByLabelText("Got it"));
    expect(
      screen.getByTestId("scan-top-overlay").getAttribute("aria-hidden"),
    ).toBeNull();
    expect(
      await screen.findByText("Line the barcode up inside the frame"),
    ).toBeTruthy();
  });

  it("keeps the camera chrome from screen readers under the carousel", () => {
    renderComponent(<ScanScreen />);
    expect(
      screen.getByTestId("scan-top-overlay").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  // Review Focus 5: nothing shows while storage loads, then it decides once.
  it("waits for storage before showing the carousel, then shows it once", async () => {
    tips.ready = false;
    renderComponent(<ScanScreen />);
    expect(screen.queryByText("Scan now")).toBeNull();
    expect(screen.queryByLabelText("Got it")).toBeNull();

    await act(async () => {
      tips.ready = true;
      tips.listeners.forEach((l) => l());
    });
    expect(screen.getAllByText("Scan now")).toHaveLength(1);
  });

  it('"?" opens HelpSheet; "Show the example again →" shows the card', () => {
    returningUser();
    renderComponent(<ScanScreen />);
    expect(screen.queryByTestId("help-sheet")).toBeNull();

    fireEvent.click(screen.getByLabelText("Scan help"));
    expect(screen.getByTestId("help-sheet")).toBeTruthy();

    fireEvent.click(screen.getByText("Show the example again →"));
    expect(screen.queryByTestId("help-sheet")).toBeNull();
    expect(screen.getByText("Scan the barcode")).toBeTruthy();

    // A card asked for through "?" doesn't spend one of the first 3 showings.
    fireEvent.click(screen.getByLabelText("Got it"));
    expect(tips.increment).not.toHaveBeenCalled();
  });
});

describe("ScanScreen guided barcode flow — step 1", () => {
  beforeEach(returningUser);

  it("has no shutter on the barcode step, and offers the keypad", () => {
    renderComponent(<ScanScreen />);
    expect(screen.queryByLabelText("Take photo")).toBeNull();
    expect(screen.getByLabelText("Type the barcode number")).toBeTruthy();
    expect(screen.getByLabelText("Flashlight")).toBeTruthy();
  });

  it("typed barcode dispatches MANUAL_BARCODE_ENTERED and fetches the product", async () => {
    renderComponent(<ScanScreen />);
    fireEvent.click(screen.getByLabelText("Type the barcode number"));
    fireEvent.click(screen.getByText("Submit typed barcode"));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        "/api/nutrition/barcode/0049000028911",
      ),
    );
    // The same found card as a scanned barcode, and the sheet closed.
    expect(await screen.findByText("Barcode found ✓")).toBeTruthy();
    expect(screen.queryByText("Submit typed barcode")).toBeNull();
  });

  it('"Not this" returns to scanning and the next sighting can lock', async () => {
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Not this"));
    expect(screen.getByLabelText("Type the barcode number")).toBeTruthy();

    await scanBarcode(BARCODE_B);
    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        `/api/nutrition/barcode/${BARCODE_B}`,
      ),
    );
  });

  // Review Focus 2 at the screen: a slow lookup for the old barcode never
  // names the new lock.
  const slowLookupFor = (code: string) => {
    let resolveSlow: () => void = () => {};
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url.endsWith(code)) {
        return new Promise((res) => {
          resolveSlow = () =>
            res({ json: async () => ({ productName: "Alpha" }) } as Response);
        });
      }
      return { json: async () => ({ productName: "Bravo" }) } as Response;
    });
    return () => resolveSlow();
  };

  it("a slow lookup for A after Not this never names B's card", async () => {
    const finishA = slowLookupFor(BARCODE_A);
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Not this"));
    await scanBarcode(BARCODE_B);
    await screen.findByText("Bravo");
    await act(async () => {
      finishA();
    });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Bravo")).toBeTruthy();
  });

  it("a slow lookup for A after typing another number never names its card", async () => {
    const finishA = slowLookupFor(BARCODE_A);
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Not this"));
    fireEvent.click(screen.getByLabelText("Type the barcode number"));
    fireEvent.click(screen.getByText("Submit typed barcode"));
    await screen.findByText("Bravo");
    await act(async () => {
      finishA();
    });
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  // The found card's lookup-error and offline states (spec concept list).
  describe("lookup failure", () => {
    it("offline: says so and offers Try again / Type it in", async () => {
      mockApiRequest.mockRejectedValue(new TypeError("Network request failed"));
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      expect(
        await screen.findByText(
          "Couldn't look this up. Check your connection.",
        ),
      ).toBeTruthy();
      expect(screen.getByLabelText("Try again")).toBeTruthy();
      expect(screen.getByLabelText("Type it in")).toBeTruthy();
      expect(screen.queryByTestId("found-card-name-skeleton")).toBeNull();
    });

    it("server error: says something went wrong", async () => {
      mockApiRequest.mockRejectedValue(
        new ApiError("500: boom", "INTERNAL_ERROR", 500),
      );
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      expect(
        await screen.findByText("Something went wrong looking this up."),
      ).toBeTruthy();
    });

    it("Try again re-runs the lookup for the same barcode", async () => {
      mockApiRequest.mockRejectedValueOnce(
        new TypeError("Network request failed"),
      );
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      fireEvent.click(await screen.findByLabelText("Try again"));
      expect(await screen.findByText(/Oat Crunch/)).toBeTruthy();
      expect(
        mockApiRequest.mock.calls.filter(
          (c) => c[1] === `/api/nutrition/barcode/${BARCODE_A}`,
        ),
      ).toHaveLength(2);
      expect(
        screen.queryByText("Couldn't look this up. Check your connection."),
      ).toBeNull();
    });

    it("Type it in opens the number sheet", async () => {
      mockApiRequest.mockRejectedValue(new TypeError("Network request failed"));
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      fireEvent.click(await screen.findByLabelText("Type it in"));
      expect(screen.getByText("Submit typed barcode")).toBeTruthy();
      // The typed number locks and looks up like a scanned one.
      mockApiRequest.mockImplementation(async () => {
        return {
          json: async () => ({ productName: "Typed Product" }),
        } as Response;
      });
      fireEvent.click(screen.getByText("Submit typed barcode"));
      expect(await screen.findByText("Typed Product")).toBeTruthy();
    });

    it("a stale failure for an old barcode does not mark the new lock", async () => {
      let rejectA: (e: unknown) => void = () => {};
      mockApiRequest.mockImplementation(async (_m: string, url: string) => {
        if (url.endsWith(BARCODE_A)) {
          return new Promise((_res, rej) => {
            rejectA = rej;
          });
        }
        return {
          json: async () => ({ productName: "Bravo" }),
        } as Response;
      });
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      fireEvent.click(await screen.findByLabelText("Not this"));
      await scanBarcode(BARCODE_B);
      await screen.findByText("Bravo");
      await act(async () => {
        rejectA(new TypeError("Network request failed"));
      });
      expect(
        screen.queryByText("Couldn't look this up. Check your connection."),
      ).toBeNull();
      expect(screen.queryByLabelText("Try again")).toBeNull();
    });
  });

  // R5: a 404 lookup says so instead of a skeleton forever.
  it("says the product is unknown when the lookup finds nothing", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("404: Product not found", "NOT_FOUND", 404),
    );
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    expect(await screen.findByText(/We don't know this one yet/)).toBeTruthy();
    expect(screen.getByLabelText("Next: nutrition →")).toBeTruthy();
  });

  it("a later successful lookup for a barcode that was not found shows its name", async () => {
    mockApiRequest.mockRejectedValueOnce(
      new ApiError("404: Product not found", "NOT_FOUND", 404),
    );
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    await screen.findByText(/We don't know this one yet/);
    fireEvent.click(screen.getByLabelText("Not this"));
    await scanBarcode(BARCODE_A);
    expect(await screen.findByText(/Oat Crunch/)).toBeTruthy();
    expect(screen.queryByText(/We don't know this one yet/)).toBeNull();
  });

  it("a slow 404 for an old barcode does not mark the new lock unknown", async () => {
    let rejectA: (e: unknown) => void = () => {};
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url.endsWith(BARCODE_A)) {
        return new Promise((_res, rej) => {
          rejectA = rej;
        });
      }
      return {
        json: async () => ({ productName: "Oat Crunch" }),
      } as Response;
    });
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Not this"));
    await scanBarcode(BARCODE_B);
    await screen.findByText("Oat Crunch");
    await act(async () => {
      rejectA(new ApiError("404: Product not found", "NOT_FOUND", 404));
    });
    expect(screen.queryByText(/We don't know this one yet/)).toBeNull();
  });
});

describe("ScanScreen guided barcode flow — steps 2 and 3", () => {
  beforeEach(returningUser);

  // Review Focus 3: the tabs stay mounted under the found card, so the
  // Barcode tab still announces its done moment.
  it("announces the Barcode step done after Next: nutrition →", async () => {
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    announce.mockClear();
    fireEvent.click(await screen.findByLabelText("Next: nutrition →"));
    // Batched with "Nutrition step in progress" (announceTogether, next tick).
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith(
        expect.stringContaining("Barcode step complete"),
      ),
    );
  });

  it("a same-barcode redo via scan resumes the step without a second lookup", async () => {
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Next: nutrition →"));
    fireEvent.click(screen.getByLabelText("Barcode, done"));
    await scanBarcode(BARCODE_A);
    // Back on the Nutrition step, with the one lookup from the first lock.
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
    expect(
      mockApiRequest.mock.calls.filter(
        (c) => c[1] === `/api/nutrition/barcode/${BARCODE_A}`,
      ),
    ).toHaveLength(1);
  });

  // VoiceOver cuts off a second announcement made in the same tick: one
  // phase change that moves the tabs, the hint and the example card must be
  // ONE announcement, content first and tab state after.
  describe("one announcement per phase change", () => {
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

    it("example card + tabs", async () => {
      tips.counts = { barcode: 3, "barcode-nutrition": 0, "barcode-front": 3 };
      const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      const next = await screen.findByLabelText("Next: nutrition →");
      await settle();
      announce.mockClear();
      fireEvent.click(next);
      await settle();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(
        "Photo the nutrition label Barcode step complete Nutrition step in progress",
      );
    });

    it("hint + tabs", async () => {
      const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      renderComponent(<ScanScreen />);
      await scanBarcode(BARCODE_A);
      const next = await screen.findByLabelText("Next: nutrition →");
      await settle();
      announce.mockClear();
      fireEvent.click(next);
      await settle();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(
        "Fit the whole panel in the frame Barcode step complete Nutrition step in progress",
      );
    });
  });

  it("Skip on the Front step navigates to NutritionDetail", async () => {
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Next: nutrition →"));
    // Step 2 has a shutter and Skip.
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Skip"));
    // Step 3.
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Skip"));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("NutritionDetail", {
        barcode: BARCODE_A,
      }),
    );
  });

  // Review Focus 1.
  /** Barcode A, a nutrition photo, auto-advance to the Front step. */
  async function reachFrontStepWithPhoto() {
    mockCapturePhotoToFile.mockResolvedValueOnce({ filePath: "/label-a.jpg" });
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    fireEvent.click(await screen.findByLabelText("Next: nutrition →"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Take photo"));
    });
    // Auto-advance (1.5 s) out of review into the Front step.
    await waitFor(
      () => expect(screen.getByLabelText("Nutrition, done")).toBeTruthy(),
      { timeout: 3000 },
    );
  }

  it("discards carried photo and toasts once the user commits to a different barcode", async () => {
    await reachFrontStepWithPhoto();

    // Redo the barcode step, then scan a different product.
    fireEvent.click(screen.getByLabelText("Barcode, done"));
    await scanBarcode(BARCODE_B);
    // Its found card still holds the old steps: nothing deleted yet.
    await screen.findByLabelText("Next: nutrition →");
    expect(mockDeleteAsync).not.toHaveBeenCalled();
    expect(mockToastInfo).not.toHaveBeenCalled();

    // Moving on with B is the commit.
    fireEvent.click(screen.getByLabelText("Next: nutrition →"));
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///label-a.jpg", {
      idempotent: true,
    });
    expect(mockToastInfo).toHaveBeenCalledWith(
      "New product: earlier photos cleared",
    );

    // Product B finishes without product A's photo.
    fireEvent.click(screen.getByLabelText("Skip"));
    fireEvent.click(screen.getByLabelText("Skip"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("NutritionDetail", {
        barcode: BARCODE_B,
      }),
    );
  }, 10000);

  it('"Not this" on a different barcode keeps the saved photo for the original product', async () => {
    await reachFrontStepWithPhoto();
    fireEvent.click(screen.getByLabelText("Barcode, done"));
    await scanBarcode(BARCODE_B);
    fireEvent.click(await screen.findByLabelText("Not this"));
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    // Finding A again resumes the Front step with its nutrition photo.
    await scanBarcode(BARCODE_A);
    expect(screen.getByLabelText("Nutrition, done")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Skip"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        "NutritionDetail",
        expect.objectContaining({
          barcode: BARCODE_A,
          nutritionImageUri: "file:///label-a.jpg",
        }),
      ),
    );
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  }, 10000);

  it("returnAfterLog: the found card logs straight away, with no photo steps", async () => {
    mockRouteParams.value = { returnAfterLog: true };
    renderComponent(<ScanScreen />);
    await scanBarcode(BARCODE_A);
    expect(await screen.findByLabelText("Log it →")).toBeTruthy();
    expect(screen.queryByLabelText("Next: nutrition →")).toBeNull();
    expect(screen.queryByLabelText("Use database data anyway")).toBeNull();

    fireEvent.click(screen.getByLabelText("Log it →"));
    // The existing returnAfterLog confirm card (Dismiss / Log It).
    expect(await screen.findByLabelText("Dismiss")).toBeTruthy();
    expect(screen.queryByLabelText("Take photo")).toBeNull();
    expect(screen.queryByLabelText("Nutrition")).toBeNull();
  });

  it("returnAfterLog shows only the Barcode tab", () => {
    mockRouteParams.value = { returnAfterLog: true };
    renderComponent(<ScanScreen />);
    expect(screen.getByLabelText("Barcode")).toBeTruthy();
    expect(screen.queryByLabelText("Nutrition")).toBeNull();
    expect(screen.queryByLabelText("Front, optional")).toBeNull();
  });
});

describe("ScanScreen generic flow", () => {
  // Barcode advice is for the barcode step only (mobile-reviewer).
  it("the generic label flow never shows barcode escalations", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      tips.seen.add("scan-tips-carousel");
      mockRouteParams.value = { mode: "label" };
      renderComponent(<ScanScreen />);
      // One tick at a time, so each hint change commits and CoachHint's
      // crossfade timer (100 ms) runs before the next.
      for (let i = 0; i < 16; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText("Type the number")).toBeNull();
      expect(screen.queryByText("Try moving closer")).toBeNull();
      expect(screen.getByText("Fit the whole panel in the frame")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a title pill and the shutter, with no tabs or example card", () => {
    mockRouteParams.value = { intent: "log" };
    renderComponent(<ScanScreen />);
    fireEvent.click(screen.getByText("Scan now"));
    expect(screen.getByText("Photo food log")).toBeTruthy();
    expect(screen.getByLabelText("Take photo")).toBeTruthy();
    expect(screen.queryByLabelText("Barcode")).toBeNull();
    expect(screen.queryByLabelText("Got it")).toBeNull();
  });
});
