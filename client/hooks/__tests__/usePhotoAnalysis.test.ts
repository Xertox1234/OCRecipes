// @vitest-environment jsdom
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { usePhotoAnalysis } from "../usePhotoAnalysis";
import {
  calculateTotals,
  confirmPhotoAnalysis,
  type PhotoAnalysisResponse,
} from "@/lib/photo-upload";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

const {
  mockImpact,
  mockNotification,
  mockUploadPhotoForAnalysis,
  mockDeleteAsyncLegacy,
  mockGoBack,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockUploadPhotoForAnalysis: vi.fn(),
  mockDeleteAsyncLegacy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    setParams: vi.fn(),
    goBack: mockGoBack,
  }),
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

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
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

describe("usePhotoAnalysis — logging the selected foods", () => {
  const food = {
    name: "Toast",
    quantity: "2 slices",
    confidence: 0.9,
    needsClarification: false,
    nutrition: {
      name: "Toast",
      calories: 240,
      protein: 8,
      carbs: 44,
      fat: 3,
      fiber: 2,
      sugar: 4,
      sodium: 300,
      servingSize: "2 slices",
      source: "usda" as const,
    },
  };

  async function renderAnalyzed() {
    mockUploadPhotoForAnalysis.mockResolvedValue(
      makeResponse({ foods: [food, { ...food, name: "Butter" }] }),
    );
    const hook = renderUsePhotoAnalysis("file://meal.jpg");
    await waitFor(() => expect(hook.result.current.selectedItems.size).toBe(2));
    // Drop the analysis-complete haptic so assertions see only the log path.
    mockNotification.mockClear();
    return hook;
  }

  it("confirms the log with a calorie toast and leaves the haptic to it", async () => {
    vi.mocked(calculateTotals).mockReturnValue({
      calories: 479.6,
      protein: 16,
      carbs: 88,
      fat: 6,
    });
    vi.mocked(confirmPhotoAnalysis).mockResolvedValue({
      id: 1,
      productName: "Toast, Butter",
    });
    const { result } = await renderAnalyzed();

    await act(async () => {
      await result.current.handleLogSelected();
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Added · 480 kcal");
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    // The toast fires the Success haptic itself.
    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it("never shows the server's error text when the log fails", async () => {
    vi.mocked(confirmPhotoAnalysis).mockRejectedValue(
      new ApiError("relation scanned_items violates constraint", "INTERNAL"),
    );
    const { result } = await renderAnalyzed();

    await act(async () => {
      await result.current.handleLogSelected();
    });

    expect(result.current.error).toBe(
      "Couldn't save this meal. Please try again.",
    );
    expect(result.current.error).not.toContain("scanned_items");
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    // Selection survives so the user can retry.
    expect(result.current.selectedItems.size).toBe(2);
  });

  it("explains a rate limit instead of the generic failure", async () => {
    vi.mocked(confirmPhotoAnalysis).mockRejectedValue(
      new ApiError("Too many requests", ErrorCode.RATE_LIMITED),
    );
    const { result } = await renderAnalyzed();

    await act(async () => {
      await result.current.handleLogSelected();
    });

    expect(result.current.error).toBe(
      "Too many requests. Please wait a moment and try again.",
    );
  });
});

describe("usePhotoAnalysis — analysis failure copy", () => {
  async function failWith(err: unknown) {
    mockUploadPhotoForAnalysis.mockRejectedValue(err);
    const hook = renderUsePhotoAnalysis("file://meal.jpg");
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    return hook.result.current.error;
  }

  it("never shows the thrown error's text", async () => {
    const error = await failWith(
      new ApiError("Upload failed: 500", "INTERNAL"),
    );
    expect(error).toBe("Couldn't analyze this photo. Please try again.");
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  it("treats non-API failures (network, auth, bad response) as generic", async () => {
    expect(await failWith(new TypeError("Network request failed"))).toBe(
      "Couldn't analyze this photo. Please try again.",
    );
  });

  it.each([
    [
      ErrorCode.LIMIT_REACHED,
      "You've reached today's scan limit. Try again tomorrow, or upgrade for unlimited scans.",
    ],
    [
      ErrorCode.RATE_LIMITED,
      "Too many requests. Please wait a moment and try again.",
    ],
    [
      ErrorCode.IMAGE_TOO_LARGE,
      "This photo is too large to analyze. Please try another.",
    ],
    [
      "SESSION_LIMIT_REACHED",
      "Too many scans in progress. Please wait a moment and try again.",
    ],
    [
      "USER_SESSION_LIMIT",
      "Too many scans in progress. Please wait a moment and try again.",
    ],
  ])("explains %s", async (code, copy) => {
    expect(await failWith(new ApiError("Upload failed: 429", code))).toBe(copy);
  });
});
