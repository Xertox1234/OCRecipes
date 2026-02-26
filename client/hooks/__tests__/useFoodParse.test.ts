// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useParseFoodText, useTranscribeFood } from "../useFoodParse";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockGetApiUrl, mockTokenStorage, mockFetch } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
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
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
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

  describe("useTranscribeFood", () => {
    it("sends FormData with audio file and auth token", async () => {
      const { wrapper } = createQueryWrapper();

      mockTokenStorage.get.mockResolvedValue("test-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            transcription: "one apple",
            items: [{ name: "Apple", quantity: 1 }],
          }),
      });

      const { result } = renderHook(() => useTranscribeFood(), { wrapper });

      await act(async () => {
        result.current.mutate("file:///audio/recording.m4a");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/food/transcribe",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer test-token" },
        }),
      );
    });

    it("throws on non-ok response", async () => {
      const { wrapper } = createQueryWrapper();

      mockTokenStorage.get.mockResolvedValue("token");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad audio format"),
      });

      const { result } = renderHook(() => useTranscribeFood(), { wrapper });

      await act(async () => {
        result.current.mutate("file:///bad.m4a");
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("400: Bad audio format");
    });
  });
});
