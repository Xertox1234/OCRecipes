// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useReceiptScan } from "../useReceiptScan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { File as MockExpoFile } from "../../../test/mocks/expo-file-system";

const { mockTokenGet, mockCompressImage, mockCleanupImage } = vi.hoisted(
  () => ({
    mockTokenGet: vi.fn(),
    mockCompressImage: vi.fn(),
    mockCleanupImage: vi.fn(),
  }),
);

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
});
