// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMenuScan } from "../useMenuScan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { File as MockExpoFile } from "../../../test/mocks/expo-file-system";

const {
  mockGetApiUrl,
  mockTokenStorage,
  mockFetch,
  mockCompressImage,
  mockCleanupImage,
  mockNotifyIfSessionExpired,
} = vi.hoisted(() => ({
  mockNotifyIfSessionExpired: vi.fn(),
  mockCompressImage: vi.fn(),
  mockCleanupImage: vi.fn(),
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
  notifyIfSessionExpired: (...args: unknown[]) =>
    mockNotifyIfSessionExpired(...args),
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

vi.mock("@/lib/image-compression", () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
  cleanupImage: (...args: unknown[]) => mockCleanupImage(...args),
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
    mockCompressImage.mockImplementation(async (uri: string) => ({
      uri: uri.replace("/photos/", "/compressed/"),
    }));
    mockCleanupImage.mockResolvedValue(undefined);
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
      "file:///compressed/menu.jpg",
    );
    append.mockRestore();
  });

  // Camera audit 2026-11-21 M3: the menu photo went up full-size, so a
  // high-resolution capture or gallery pick over the server's 5 MB cap failed.
  it("compresses the photo before upload and deletes the compressed copy", async () => {
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

    expect(mockCompressImage).toHaveBeenCalledWith(
      "file:///photos/menu.jpg",
      expect.objectContaining({ targetSizeKB: expect.any(Number) }),
    );
    expect(mockCleanupImage).toHaveBeenCalledWith(
      "file:///compressed/menu.jpg",
    );
  });

  it("deletes the compressed copy when the upload fails", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");
    mockFetch.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useMenuScan(), { wrapper });
    await act(async () => {
      result.current.mutate("file:///photos/menu.jpg");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockCleanupImage).toHaveBeenCalledWith(
      "file:///compressed/menu.jpg",
    );
  });

  // Camera audit 2026-11-21 M4: the menu upload sends its own bearer, so a
  // revoked token must reach the shared session-expiry check.
  it("passes a 401 response to the session-expiry check", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");
    const response = {
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve('{"error":"Token expired","code":"TOKEN_EXPIRED"}'),
    };
    mockFetch.mockResolvedValue(response);

    const { result } = renderHook(() => useMenuScan(), { wrapper });
    await act(async () => {
      result.current.mutate("file:///photos/menu.jpg");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockNotifyIfSessionExpired).toHaveBeenCalledWith(response, "token");
  });
});
