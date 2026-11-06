// @vitest-environment jsdom
import React from "react";
import { act, screen } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptReviewScreen from "../ReceiptReviewScreen";
import { LOADING_ANNOUNCEMENT_DELAY_MS } from "@/hooks/useDelayedLoadingAnnouncement";

// Accessibility audit 2026-11-06 H1/M1: every state of this modal route keeps
// VoiceOver inside it, and the scan's loading / failure / AI-update
// transitions are spoken.

const { mockScan } = vi.hoisted(() => ({
  mockScan: {
    state: "pending" as "pending" | "error" | "success",
    result: null as unknown,
    ocrTexts: undefined as string[] | undefined,
  },
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    replace: vi.fn(),
    popToTop: vi.fn(),
    goBack: vi.fn(),
  }),
  useRoute: () => ({
    params: { photoUris: ["file://r.jpg"], ocrTexts: mockScan.ocrTexts },
  }),
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({ trigger: vi.fn(), animatedStyle: {} }),
}));

vi.mock("@/components/SwipeableRow", () => ({
  SwipeableRow: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/useReceiptScan", () => ({
  useReceiptScan: () => ({
    mutate: (
      _uris: string[],
      opts: { onSuccess: (r: unknown) => void; onError: (e: Error) => void },
    ) => {
      if (mockScan.state === "success") opts.onSuccess(mockScan.result);
      if (mockScan.state === "error") opts.onError(new Error("scan failed"));
    },
    isPending: mockScan.state === "pending",
    isError: mockScan.state === "error",
    isSuccess: mockScan.state === "success",
  }),
  useReceiptConfirm: () => ({ mutate: vi.fn(), isPending: false }),
}));

const FOUR_ITEM_RECEIPT = [
  "CORNER SHOP\nBREAD 2.49\nEGGS 3.99\nAPPLES 1.25\nCHEESE 4.50\nTOTAL 12.23",
];

const aiMilk = {
  items: [
    {
      name: "Milk",
      quantity: 1,
      unit: "each",
      category: "dairy",
      isFood: true,
      estimatedShelfLifeDays: 7,
      confidence: 0.9,
    },
  ],
  isPartialExtraction: false,
  overallConfidence: 0.9,
};

/** The nearest `aria-modal` ancestor of the given text, or null. */
function modalRootOf(text: string): Element | null {
  return screen.getByText(text).closest('[aria-modal="true"]');
}

let announce: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockScan.state = "pending";
  mockScan.result = null;
  mockScan.ocrTexts = undefined;
  announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
});

afterEach(() => {
  announce.mockRestore();
  vi.useRealTimers();
});

describe("ReceiptReviewScreen — accessibility", () => {
  it("the loading state is modal and announces loading", () => {
    vi.useFakeTimers();
    renderComponent(<ReceiptReviewScreen />);

    expect(modalRootOf("Analyzing receipt...")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);
    });
    expect(announce).toHaveBeenCalledWith("Loading");
  });

  it("the failed-scan state is modal and the failure is spoken", () => {
    mockScan.state = "error";
    renderComponent(<ReceiptReviewScreen />);

    expect(modalRootOf("Could not read the receipt")).not.toBeNull();
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining("Could not read the receipt"),
    );
  });

  it("a failed AI scan behind a local OCR preview is not announced as a failure", () => {
    mockScan.state = "error";
    mockScan.ocrTexts = FOUR_ITEM_RECEIPT;
    renderComponent(<ReceiptReviewScreen />);

    expect(announce).not.toHaveBeenCalledWith(
      expect.stringContaining("Could not read the receipt"),
    );
  });

  it("the no-items state is modal", () => {
    mockScan.state = "success";
    mockScan.result = { ...aiMilk, items: [] };
    renderComponent(<ReceiptReviewScreen />);

    expect(modalRootOf("No food items found")).not.toBeNull();
  });

  it("an AI result replacing the OCR preview is announced on iOS", () => {
    mockScan.state = "success";
    mockScan.result = aiMilk;
    mockScan.ocrTexts = FOUR_ITEM_RECEIPT;
    renderComponent(<ReceiptReviewScreen />);

    expect(screen.getByText("Updated with AI analysis")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Updated with AI analysis");
  });
});
