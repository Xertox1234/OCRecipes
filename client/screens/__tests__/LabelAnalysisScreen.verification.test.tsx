// @vitest-environment jsdom
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import LabelAnalysisScreen from "../LabelAnalysisScreen";
import FrontLabelConfirmScreen, {
  frontLabelSavedKey,
} from "../FrontLabelConfirmScreen";

const {
  mockGoBack,
  mockPop,
  mockNavigate,
  mockReplace,
  mockApiRequest,
  mockUpload,
  mockConfirmFrontLabel,
  mockRoute,
  focusEffectCb,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpload: vi.fn(),
  mockConfirmFrontLabel: vi.fn(),
  mockRoute: { params: {} as Record<string, unknown> },
  // Captures the latest callback LabelAnalysisScreen hands useFocusEffect, so a
  // test can simulate the screen regaining focus by invoking it directly.
  focusEffectCb: { current: null as (() => void) | null },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    pop: mockPop,
    navigate: mockNavigate,
    replace: mockReplace,
  }),
  useRoute: () => mockRoute,
  useFocusEffect: (cb: () => void) => {
    focusEffectCb.current = cb;
  },
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
  // FrontLabelConfirmScreen (rendered by the front-label-saved tests below).
  uploadFrontLabelPhoto: vi.fn(),
  confirmFrontLabel: mockConfirmFrontLabel,
}));

// LabelAnalysisScreen deletes its captured temp photo on unmount — the real
// module hits a native module at import time under jsdom.
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn().mockResolvedValue(undefined),
}));

const BARCODE = "0778918011332";

const UPLOAD_RESULT = {
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
};

describe("LabelAnalysisScreen — verification mode Done", () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockPop.mockClear();
    mockNavigate.mockClear();
    mockReplace.mockClear();
    mockUpload.mockResolvedValue(UPLOAD_RESULT);
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

// After a verification the screen offers "Scan Front Label". Saving that front
// label (FrontLabelConfirm -> pop(2)) lands back here, but `canScanFrontLabel`
// is a snapshot of the verify response and nothing refreshed it, so the CTA
// kept rendering. The two screens share only the query cache, so these tests
// render both under ONE query client.
describe("LabelAnalysisScreen — Scan Front Label CTA after the front label is saved", () => {
  const FRONT_LABEL_DATA = {
    brand: "Acme",
    productName: "Test Product",
    netWeight: "12 oz",
    claims: [],
    confidence: 0.9,
  };

  beforeEach(() => {
    mockPop.mockClear();
    mockConfirmFrontLabel.mockReset();
    mockConfirmFrontLabel.mockResolvedValue({
      success: true,
      frontLabelScanned: true,
    });
    focusEffectCb.current = null;
    mockUpload.mockResolvedValue(UPLOAD_RESULT);
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        verified: true,
        isMatch: true,
        verificationLevel: "single_verified",
        verificationCount: 1,
        canScanFrontLabel: true,
      }),
    });
    // One mocked route serves both screens: LabelAnalysis reads imageUri /
    // barcode / verificationMode / verifyBarcode, FrontLabelConfirm reads
    // imageUri / barcode / sessionId / data. A non-null sessionId keeps
    // FrontLabelConfirm from starting its mount-time AI upload.
    mockRoute.params = {
      imageUri: "file:///label.jpg",
      barcode: BARCODE,
      verificationMode: true,
      verifyBarcode: BARCODE,
      sessionId: "front-session-1",
      data: FRONT_LABEL_DATA,
    };
  });

  async function renderWithFrontLabelCta() {
    const { queryClient, wrapper } = createQueryWrapper();
    render(<LabelAnalysisScreen />, { wrapper });
    const submit = await screen.findByText("Submit Verification");
    await act(async () => {
      fireEvent.click(submit);
    });
    // Control: the CTA is on screen to begin with.
    await screen.findByText("Scan Front Label");
    return { queryClient, wrapper };
  }

  // LabelAnalysis regaining focus is what pop(2) from FrontLabelConfirm does.
  function refocusLabelAnalysis() {
    // Control: the screen registered a focus effect at all — without it a
    // refocus is a silent no-op and the "keeps the CTA" tests below pass
    // vacuously.
    expect(focusEffectCb.current).toBeTypeOf("function");
    act(() => {
      focusEffectCb.current?.();
    });
  }

  it("hides the CTA once the user returns from saving the front label", async () => {
    const { wrapper } = await renderWithFrontLabelCta();

    // The CTA pushes Scan(front-label) -> FrontLabelConfirm, where the user
    // saves. LabelAnalysis stays mounted (but blurred) underneath.
    render(<FrontLabelConfirmScreen />, { wrapper });
    fireEvent.click(screen.getByText("Looks Good"));
    await waitFor(() => expect(mockPop).toHaveBeenCalledWith(2));
    expect(mockConfirmFrontLabel).toHaveBeenCalledWith(
      "front-session-1",
      BARCODE,
    );

    refocusLabelAnalysis();

    await waitFor(() =>
      expect(screen.queryByText("Scan Front Label")).toBeNull(),
    );
    // Only the CTA goes — the verification result and Done are untouched.
    expect(screen.getByText(/Thanks for verifying/)).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  // Control for the test above: a refocus alone (Retake, or backing out of the
  // front-label flow without saving) must not hide a CTA that is still valid.
  it("keeps the CTA when the user returns without saving the front label", async () => {
    await renderWithFrontLabelCta();

    refocusLabelAnalysis();

    expect(screen.getByText("Scan Front Label")).toBeTruthy();
  });

  // Control: the signal is per product — a saved front label for another
  // barcode says nothing about this one.
  it("keeps the CTA when the saved front label belongs to a different product", async () => {
    const { queryClient } = await renderWithFrontLabelCta();

    queryClient.setQueryData(frontLabelSavedKey("0000000000017"), true);
    refocusLabelAnalysis();

    expect(screen.getByText("Scan Front Label")).toBeTruthy();
  });

  // The signal is written once and read back later with nothing observing it,
  // so its gc timer is scheduled once at first write — pin it, or the default
  // 5 minutes drops it early (docs/rules/hooks.md, ephemeral query-cache state).
  it("pins the saved signal against query-cache garbage collection", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    render(<FrontLabelConfirmScreen />, { wrapper });
    fireEvent.click(screen.getByText("Looks Good"));
    await waitFor(() => expect(mockPop).toHaveBeenCalledWith(2));

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: frontLabelSavedKey(BARCODE) });
    expect(query?.state.data).toBe(true);
    expect(query?.gcTime).toBe(Infinity);
  });
});
