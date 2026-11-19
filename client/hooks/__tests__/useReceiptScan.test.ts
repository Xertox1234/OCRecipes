// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useReceiptScan } from "../useReceiptScan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { File as MockExpoFile } from "../../../test/mocks/expo-file-system";

const {
  mockTokenGet,
  mockCompressImage,
  mockCleanupImage,
  mockLogWarn,
  mockLogInfo,
} = vi.hoisted(() => ({
  mockTokenGet: vi.fn(),
  mockCompressImage: vi.fn(),
  mockCleanupImage: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogInfo: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: mockLogWarn, info: mockLogInfo, error: vi.fn() },
}));

vi.mock("@/lib/query-client", () => ({
  getApiUrl: () => "http://localhost:3000",
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: () => mockTokenGet() },
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

describe("useReceiptScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenGet.mockResolvedValue("test-token");
    mockCompressImage.mockResolvedValue({ uri: "file://compressed.jpg" });
    mockCleanupImage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts the in-flight scan fetch when the consumer unmounts", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          capturedSignal = init.signal ?? undefined;
          // Reject on abort, mirroring real fetch behaviour.
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryWrapper();
    const { result, unmount } = renderHook(() => useReceiptScan(), { wrapper });

    act(() => {
      result.current.mutate(["file://photo.jpg"]);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("a superseded scan rejects as AbortError even when expo/fetch rejects with a plain Error (M-obs-1)", async () => {
    // expo/fetch (the global fetch on a device) rejects an abort before
    // headers as a plain Error, not an AbortError; the global mutation net
    // would show "Something went wrong" for a cancel the user caused.
    let calls = 0;
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          calls += 1;
          if (calls > 1) {
            resolve(new Response(JSON.stringify({}), { status: 500 }));
            return;
          }
          init.signal?.addEventListener("abort", () =>
            reject(new Error("fetch failed: Fetch request has been canceled")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useReceiptScan(), { wrapper });

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.mutateAsync(["file://photo-1.jpg"]);
    });
    const firstOutcome = first.catch((e: unknown) => e);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    act(() => {
      result.current.mutateAsync(["file://photo-2.jpg"]).catch(() => {});
    });

    expect(await firstOutcome).toMatchObject({ name: "AbortError" });
  });

  it("appends each compressed photo as a file object expo/fetch can send", async () => {
    const append = vi.spyOn(FormData.prototype, "append");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useReceiptScan(), { wrapper });

    act(() => {
      result.current.mutate(["file://a.jpg", "file://b.jpg"]);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const photoParts = append.mock.calls.filter(([name]) => name === "photos");
    expect(photoParts).toHaveLength(2);
    for (const [, part] of photoParts) {
      expect(part).toBeInstanceOf(MockExpoFile);
      expect((part as unknown as { uri: string }).uri).toBe(
        "file://compressed.jpg",
      );
    }
    append.mockRestore();
  });

  // A failed scan shows only "Could not read the receipt". Nightly E2E runs
  // ended there with no request reaching the server and nothing in any log,
  // so the step that failed could not be told apart. Name it.
  describe("logs the step a failed scan stopped at", () => {
    const okResult = {
      items: [],
      isPartialExtraction: false,
      overallConfidence: 1,
    };

    it("names compress when compression rejects", async () => {
      const failure = new Error("Image resize timed out after 30000 ms");
      mockCompressImage.mockRejectedValue(failure);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useReceiptScan(), { wrapper });
      act(() => {
        result.current.mutate(["file://photo.jpg"]);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/^Receipt scan failed at compress after \d+ ms$/),
        failure,
      );
    });

    it("names upload when the request itself rejects", async () => {
      const failure = new TypeError("Network request failed");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw failure;
        }),
      );

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useReceiptScan(), { wrapper });
      act(() => {
        result.current.mutate(["file://photo.jpg"]);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/^Receipt scan failed at upload after \d+ ms$/),
        failure,
      );
    });

    it("does not log a scan aborted by unmount", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            }),
        ),
      );

      const { wrapper } = createQueryWrapper();
      const { result, unmount } = renderHook(() => useReceiptScan(), {
        wrapper,
      });
      act(() => {
        result.current.mutate(["file://photo.jpg"]);
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    it("logs each step's duration when the scan succeeds", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => okResult })),
      );

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useReceiptScan(), { wrapper });
      act(() => {
        result.current.mutate(["file://photo.jpg"]);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockLogWarn).not.toHaveBeenCalled();
      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Receipt scan took compress \d+ ms, upload \d+ ms, response \d+ ms$/,
        ),
      );
    });
  });
});
