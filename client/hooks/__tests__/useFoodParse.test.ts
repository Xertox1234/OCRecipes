// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useParseFoodText } from "../useFoodParse";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useFoodParse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useParseFoodText", () => {
    it("calls parse-text endpoint with text", async () => {
      const { wrapper } = createQueryWrapper();

      const items = [
        { name: "Apple", quantity: 1, unit: "medium", calories: 95 },
      ];
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items }),
      });

      const { result } = renderHook(() => useParseFoodText(), { wrapper });

      await act(async () => {
        result.current.mutate("1 medium apple");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/food/parse-text",
        {
          text: "1 medium apple",
        },
      );
      expect(result.current.data?.items).toEqual(items);
    });
  });
});
