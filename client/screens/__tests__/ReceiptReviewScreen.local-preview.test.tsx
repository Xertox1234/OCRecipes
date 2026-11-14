// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptReviewScreen from "../ReceiptReviewScreen";

// The on-device OCR text shows as an instant preview while the AI scan runs,
// and a later AI result that replaces it says so with a toast.

const { mockRoute, mockScan } = vi.hoisted(() => ({
  mockRoute: {
    value: { photoUris: ["file://r.jpg"] } as {
      photoUris: string[];
      ocrTexts?: string[];
    },
  },
  // null = the AI scan never settles during the test.
  mockScan: { result: null as unknown },
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
  useRoute: () => ({ params: mockRoute.value }),
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
    mutate: (_uris: string[], opts: { onSuccess: (r: unknown) => void }) => {
      if (mockScan.result) opts.onSuccess(mockScan.result);
    },
    isPending: mockScan.result === null,
    isError: false,
    isSuccess: mockScan.result !== null,
  }),
  useReceiptConfirm: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Four priced lines: the parser's confidence is items / 8, and the preview
// needs at least 0.5.
const FOUR_ITEM_RECEIPT = [
  "CORNER SHOP\nBREAD 2.49\nEGGS 3.99\nAPPLES 1.25\nCHEESE 4.50\nTOTAL 12.23",
];
const THREE_ITEM_RECEIPT = [
  "CORNER SHOP\nBREAD 2.49\nEGGS 3.99\nAPPLES 1.25\nTOTAL 7.73",
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

const qtyBox = (name: string) =>
  screen.queryByLabelText(`Quantity for ${name}, each`);

beforeEach(() => {
  mockRoute.value = { photoUris: ["file://r.jpg"] };
  mockScan.result = null;
});

describe("ReceiptReviewScreen — local OCR preview", () => {
  it("lists the OCR items while the AI scan is still running", () => {
    mockRoute.value = {
      photoUris: ["file://r.jpg"],
      ocrTexts: FOUR_ITEM_RECEIPT,
    };
    renderComponent(<ReceiptReviewScreen />);
    for (const name of ["BREAD", "EGGS", "APPLES", "CHEESE"]) {
      expect(qtyBox(name)).not.toBeNull();
    }
  });

  it("shows no preview for a low-confidence OCR read", () => {
    mockRoute.value = {
      photoUris: ["file://r.jpg"],
      ocrTexts: THREE_ITEM_RECEIPT,
    };
    renderComponent(<ReceiptReviewScreen />);
    expect(qtyBox("BREAD")).toBeNull();
  });

  it("replaces the preview with the AI result and says it was updated", () => {
    mockRoute.value = {
      photoUris: ["file://r.jpg"],
      ocrTexts: FOUR_ITEM_RECEIPT,
    };
    mockScan.result = aiMilk;
    renderComponent(<ReceiptReviewScreen />);
    expect(qtyBox("Milk")).not.toBeNull();
    expect(qtyBox("BREAD")).toBeNull();
    expect(screen.queryByText("Updated with AI analysis")).not.toBeNull();
  });

  it("shows no update toast when there was no preview to replace", () => {
    mockScan.result = aiMilk;
    renderComponent(<ReceiptReviewScreen />);
    expect(qtyBox("Milk")).not.toBeNull();
    expect(screen.queryByText("Updated with AI analysis")).toBeNull();
  });
});
