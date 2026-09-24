// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import LabelAnalysisScreen from "../LabelAnalysisScreen";

const {
  mockGoBack,
  mockPop,
  mockNavigate,
  mockReplace,
  mockApiRequest,
  mockUpload,
  mockRoute,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpload: vi.fn(),
  mockRoute: { params: {} as Record<string, unknown> },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    pop: mockPop,
    navigate: mockNavigate,
    replace: mockReplace,
  }),
  useRoute: () => mockRoute,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 0,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));

vi.mock("@/lib/photo-upload", () => ({
  uploadLabelForAnalysis: mockUpload,
  confirmLabelAnalysis: vi.fn(),
}));

const BARCODE = "0778918011332";

describe("LabelAnalysisScreen — verification mode Done", () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockPop.mockClear();
    mockNavigate.mockClear();
    mockReplace.mockClear();
    mockUpload.mockResolvedValue({
      sessionId: "session-1",
      labelData: {
        servingSize: "1 cup",
        servingsPerContainer: 2,
        calories: 250,
        totalFat: 10,
        saturatedFat: 2,
        transFat: 0,
        cholesterol: 5,
        sodium: 300,
        totalCarbs: 30,
        dietaryFiber: 3,
        totalSugars: 12,
        addedSugars: 5,
        protein: 8,
        vitaminD: null,
        calcium: null,
        iron: null,
        potassium: null,
        confidence: 0.9,
      },
    });
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        verified: true,
        isMatch: true,
        verificationLevel: "single_verified",
        verificationCount: 1,
        canScanFrontLabel: false,
      }),
    });
  });

  // The verification flow's stack is Scan -> NutritionDetail -> Scan
  // (label mode, pushed by "Help verify this product") -> LabelAnalysis.
  // A plain goBack() lands on that second Scan's live camera; pop(2) returns
  // to the product the user was verifying, as FrontLabelConfirm's
  // "Add product details" flow already does.
  it("returns past the label camera to the product after a verification", async () => {
    mockRoute.params = {
      imageUri: "file:///label.jpg",
      barcode: BARCODE,
      verificationMode: true,
      verifyBarcode: BARCODE,
    };
    renderComponent(<LabelAnalysisScreen />);

    const submit = await screen.findByText("Submit Verification");
    await act(async () => {
      fireEvent.click(submit);
    });
    const done = await screen.findByText("Done");
    fireEvent.click(done);
    // Control: the tap reached the Done handler (goBack on the base code).
    await waitFor(() =>
      expect(mockPop.mock.calls.length + mockGoBack.mock.calls.length).toBe(1),
    );

    await waitFor(() => expect(mockPop).toHaveBeenCalledWith(2));
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/verification/submit",
      { barcode: BARCODE, sessionId: "session-1" },
    );
  });

  // The front-label CTA used to `replace()` this screen with Scan(front-label),
  // so FrontLabelConfirm's pop(2) landed on the Scan(label) camera underneath
  // instead of back here. It must `navigate()` (push) so LabelAnalysis stays
  // on the stack for pop(2) to land on.
  it("pushes (navigate, not replace) to Scan front-label from the front-label CTA", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        verified: true,
        isMatch: true,
        verificationLevel: "single_verified",
        verificationCount: 1,
        canScanFrontLabel: true,
      }),
    });
    mockRoute.params = {
      imageUri: "file:///label.jpg",
      barcode: BARCODE,
      verificationMode: true,
      verifyBarcode: BARCODE,
    };
    renderComponent(<LabelAnalysisScreen />);

    const submit = await screen.findByText("Submit Verification");
    await act(async () => {
      fireEvent.click(submit);
    });

    const scanFrontLabel = await screen.findByText("Scan Front Label");
    fireEvent.click(scanFrontLabel);

    // Control: the tap reached a navigation call (navigate on the fixed code).
    await waitFor(() =>
      expect(
        mockNavigate.mock.calls.length + mockReplace.mock.calls.length,
      ).toBe(1),
    );

    expect(mockNavigate).toHaveBeenCalledWith("Scan", {
      mode: "front-label",
      verifyBarcode: BARCODE,
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
