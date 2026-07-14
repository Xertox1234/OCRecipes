// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useNutritionLookup } from "../useNutritionLookup";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const {
  mockGoBack,
  mockToastError,
  mockToastSuccess,
  mockApiRequest,
  mockNotification,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockApiRequest: vi.fn(),
  mockNotification: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: 1 } }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ notification: mockNotification, impact: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

// This mutation has no client-visible failure path today — onError only fires
// a haptic. These tests describe the intended behavior (a toast on failure,
// silence on success) and are expected to fail until that's wired up.
describe("useNutritionLookup — addToLogMutation error surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces an error toast when POST /api/scanned-items fails", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("network down"));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "photo.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.handleAddToLog();
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("does not show an error toast and navigates back on success", async () => {
    mockApiRequest.mockResolvedValueOnce({
      json: async () => ({ id: 1 }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "photo.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.handleAddToLog();
    });

    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
