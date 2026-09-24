// @vitest-environment jsdom
import React from "react";
import { act, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import LabelAnalysisScreen from "../LabelAnalysisScreen";

const {
  mockGoBack,
  mockPop,
  mockNavigate,
  mockReplace,
  mockApiRequest,
  mockUpload,
  mockDeleteAsync,
  mockRoute,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpload: vi.fn(),
  mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
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

vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsync,
}));

const BARCODE = "0778918011332";
const IMAGE_URI = "file:///label-capture.jpg";

describe("LabelAnalysisScreen — captured temp photo cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockRoute.params = { imageUri: IMAGE_URI, barcode: BARCODE };
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
  });

  // Reproduces audit finding L2: capturePhotoToFile writes to the OS temp
  // dir and nothing ever deletes it. Fails on main (deleteAsync is never
  // imported/called by this screen).
  it("deletes the captured photo file once the screen unmounts", async () => {
    const { unmount } = renderComponent(<LabelAnalysisScreen />);

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith(IMAGE_URI, {
      idempotent: true,
    });
  });

  // Negative control: while the screen is still mounted and a retry can
  // still re-read imageUri, the file must survive — cleanup is unmount-only,
  // never a focus-based effect (docs/solutions comment in the source: the
  // front-label CTA keeps this screen on the stack for pop(2), and the
  // upload effect re-reads imageUri on retryToken).
  it("does not delete the file while the screen is still mounted", async () => {
    renderComponent(<LabelAnalysisScreen />);

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });
});
