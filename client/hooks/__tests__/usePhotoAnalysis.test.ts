// @vitest-environment jsdom
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { usePhotoAnalysis } from "../usePhotoAnalysis";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

const { mockImpact, mockNotification, mockUploadPhotoForAnalysis } = vi.hoisted(
  () => ({
    mockImpact: vi.fn(),
    mockNotification: vi.fn(),
    mockUploadPhotoForAnalysis: vi.fn(),
  }),
);

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setParams: vi.fn() }),
  useFocusEffect: () => {},
}));

vi.mock("expo-file-system", () => ({
  deleteAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/lib/photo-upload", () => ({
  uploadPhotoForAnalysis: mockUploadPhotoForAnalysis,
  submitFollowUp: vi.fn(),
  confirmPhotoAnalysis: vi.fn(),
  calculateTotals: vi.fn(() => ({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  })),
  lookupNutritionByPrep: vi.fn(),
}));

function makeResponse(
  overrides: Partial<PhotoAnalysisResponse> = {},
): PhotoAnalysisResponse {
  return {
    sessionId: "s1",
    intent: "log",
    foods: [],
    overallConfidence: 0.9,
    needsFollowUp: false,
    followUpQuestions: [],
    ...overrides,
  };
}

function renderUsePhotoAnalysis(imageUri: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => usePhotoAnalysis(imageUri, "log"), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePhotoAnalysis — confidence-tiered completion haptic", () => {
  it("fires Success for a high-confidence result", async () => {
    mockUploadPhotoForAnalysis.mockResolvedValue(
      makeResponse({ overallConfidence: 0.9 }),
    );

    renderUsePhotoAnalysis("file://high.jpg");

    await waitFor(() =>
      expect(mockNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Success,
      ),
    );
  });

  it("fires Warning for a medium-confidence result", async () => {
    mockUploadPhotoForAnalysis.mockResolvedValue(
      makeResponse({ overallConfidence: 0.6 }),
    );

    renderUsePhotoAnalysis("file://medium.jpg");

    await waitFor(() =>
      expect(mockNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Warning,
      ),
    );
  });

  it("fires Warning (not silent) for a low-confidence result", async () => {
    mockUploadPhotoForAnalysis.mockResolvedValue(
      makeResponse({ overallConfidence: 0.2 }),
    );

    renderUsePhotoAnalysis("file://low.jpg");

    await waitFor(() =>
      expect(mockNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Warning,
      ),
    );
  });
});
