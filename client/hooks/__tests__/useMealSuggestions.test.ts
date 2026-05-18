// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMealSuggestions } from "../useMealSuggestions";
import { ApiError } from "@/lib/api-error";
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

  it("propagates ApiError thrown by apiRequest on non-ok response", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockRejectedValue(
      new ApiError(
        '403: {"error":"Premium feature","code":"PREMIUM_REQUIRED"}',
        "PREMIUM_REQUIRED",
      ),
    );

    const { result } = renderHook(() => useMealSuggestions(), { wrapper });

    await act(async () => {
      result.current.mutate({ date: "2024-01-01", mealType: "dinner" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe("PREMIUM_REQUIRED");
  });
});
