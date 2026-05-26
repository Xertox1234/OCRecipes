// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useReceiptScan } from "../useReceiptScan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

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

describe("useReceiptScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenGet.mockResolvedValue("test-token");
    mockCompressImage.mockResolvedValue({ uri: "file://compressed.jpg" });
    mockCleanupImage.mockResolvedValue(undefined);
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

    vi.unstubAllGlobals();
  });
});
