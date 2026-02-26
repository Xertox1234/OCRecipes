// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMealSuggestions } from "../useMealSuggestions";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useMealSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls suggest endpoint with date and meal type", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          suggestions: [{ name: "Grilled Chicken", calories: 300 }],
        }),
    });

    const { result } = renderHook(() => useMealSuggestions(), { wrapper });

    await act(async () => {
      result.current.mutate({ date: "2024-01-01", mealType: "dinner" });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/suggest",
      {
        date: "2024-01-01",
        mealType: "dinner",
      },
    );
  });

  it("throws ApiError on non-ok response with error code", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ error: "Premium feature", code: "PREMIUM_REQUIRED" }),
    });

    const { result } = renderHook(() => useMealSuggestions(), { wrapper });

    await act(async () => {
      result.current.mutate({ date: "2024-01-01", mealType: "dinner" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("Premium feature");
  });

  it("handles json parse failure gracefully", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Invalid JSON")),
    });

    const { result } = renderHook(() => useMealSuggestions(), { wrapper });

    await act(async () => {
      result.current.mutate({ date: "2024-01-01", mealType: "lunch" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("Unknown error");
  });
});
