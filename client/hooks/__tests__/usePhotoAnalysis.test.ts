// @vitest-environment jsdom
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { usePhotoAnalysis } from "../usePhotoAnalysis";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

const {
  mockImpact,
  mockNotification,
  mockUploadPhotoForAnalysis,
  mockDeleteAsyncLegacy,
} = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockUploadPhotoForAnalysis: vi.fn(),
  mockDeleteAsyncLegacy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setParams: vi.fn() }),
  // Actually runs the focus-effect callback (and its returned cleanup) via a
  // real useEffect, instead of no-op'ing it — a no-op mock never executes the
  // cleanup closure, hiding bugs inside it from the whole test file (see
  // docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md).
  useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
}));

// The real cleanup imports from the /legacy subpath (see the solution doc
// above) — mock that path, not the package root, so this test's assertions
// match the production import id.
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsyncLegacy,
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

describe("usePhotoAnalysis — temp photo cleanup on focus-effect teardown", () => {
  // Reproduces the bug documented in
  // docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md:
  // the hook imports deleteAsync from the package root, whose export is a
  // throwing stub in the installed expo-file-system version, so this cleanup
  // has never actually deleted a file. The useFocusEffect mock above actually
  // runs the effect + its cleanup (via a real useEffect), so unmounting here
  // exercises the real cleanup closure end to end.
  it("deletes the photo via expo-file-system/legacy's deleteAsync when the screen unmounts", async () => {
    mockUploadPhotoForAnalysis.mockResolvedValue(makeResponse());

    const { unmount } = renderUsePhotoAnalysis("file://cleanup-target.jpg");

    await waitFor(() => expect(mockUploadPhotoForAnalysis).toHaveBeenCalled());
    expect(mockDeleteAsyncLegacy).not.toHaveBeenCalled();

    unmount();

    expect(mockDeleteAsyncLegacy).toHaveBeenCalledWith(
      "file://cleanup-target.jpg",
      { idempotent: true },
    );
  });
});
