// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMenuScan } from "../useMenuScan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockGetApiUrl, mockTokenStorage, mockFetch } = vi.hoisted(() => ({
  mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  getApiUrl: () => mockGetApiUrl(),
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("useMenuScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends FormData with photo and returns analysis result", async () => {
    const { wrapper } = createQueryWrapper();

    const mockResult = {
      restaurantName: "Pizza Place",
      menuItems: [
        {
          name: "Margherita",
          estimatedCalories: 800,
          estimatedProtein: 30,
          estimatedCarbs: 90,
          estimatedFat: 35,
          tags: ["vegetarian"],
        },
      ],
    };

    mockTokenStorage.get.mockResolvedValue("token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const { result } = renderHook(() => useMenuScan(), { wrapper });

    await act(async () => {
      result.current.mutate("file:///photos/menu.jpg");
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/menu/scan",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token" },
      }),
    );
    expect(result.current.data?.restaurantName).toBe("Pizza Place");
  });

  it("throws on non-ok response", async () => {
    const { wrapper } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue("token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 413,
      text: () => Promise.resolve("Image too large"),
    });

    const { result } = renderHook(() => useMenuScan(), { wrapper });

    await act(async () => {
      result.current.mutate("file:///photos/huge.jpg");
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("413: Image too large");
  });
});
