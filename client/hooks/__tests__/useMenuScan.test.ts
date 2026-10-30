// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMenuScan } from "../useMenuScan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { File as MockExpoFile } from "../../../test/mocks/expo-file-system";

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

// `expo/fetch` (the global fetch since Expo SDK 57) only serializes FormData
// parts that are strings, Blobs, or objects with `bytes()` — a React Native
// `{ uri, type, name }` object throws "Unsupported FormDataPart implementation"
// on device. jsdom's FormData stringifies anything, so assert the part type.
vi.mock(
  "expo-file-system",
  () => import("../../../test/mocks/expo-file-system"),
);

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

  it("appends the photo as a file object expo/fetch can send", async () => {
    const append = vi.spyOn(FormData.prototype, "append");
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ menuItems: [] }),
    });

    const { result } = renderHook(() => useMenuScan(), { wrapper });
    await act(async () => {
      result.current.mutate("file:///photos/menu.jpg");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const photoParts = append.mock.calls.filter(([name]) => name === "photo");
    expect(photoParts).toHaveLength(1);
    expect(photoParts[0][1]).toBeInstanceOf(MockExpoFile);
    expect((photoParts[0][1] as unknown as { uri: string }).uri).toBe(
      "file:///photos/menu.jpg",
    );
    append.mockRestore();
  });
});
