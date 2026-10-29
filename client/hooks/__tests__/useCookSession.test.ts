// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAddCookPhoto } from "../useCookSession";
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

describe("useAddCookPhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenGet.mockResolvedValue("test-token");
    mockCompressImage.mockResolvedValue({ uri: "file://compressed.jpg" });
    mockCleanupImage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends the compressed photo as a file object expo/fetch can send", async () => {
    const append = vi.spyOn(FormData.prototype, "append");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ingredients: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAddCookPhoto(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        sessionId: "s1",
        photoUri: "file://orange.jpg",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/cooking/sessions/s1/photos",
      expect.objectContaining({ method: "POST" }),
    );
    const photoParts = append.mock.calls.filter(([name]) => name === "photo");
    expect(photoParts).toHaveLength(1);
    expect(photoParts[0][1]).toBeInstanceOf(MockExpoFile);
    expect((photoParts[0][1] as unknown as { uri: string }).uri).toBe(
      "file://compressed.jpg",
    );
    await waitFor(() =>
      expect(mockCleanupImage).toHaveBeenCalledWith("file://compressed.jpg"),
    );
    append.mockRestore();
  });

  it("cleans up the compressed photo when the upload part cannot be built", async () => {
    const append = vi
      .spyOn(FormData.prototype, "append")
      .mockImplementationOnce(() => {
        throw new Error(
          "Cannot upload file://compressed.jpg: unknown image type",
        );
      });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAddCookPhoto(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          sessionId: "s1",
          photoUri: "file://orange.jpg",
        }),
      ).rejects.toThrow("unknown image type");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCleanupImage).toHaveBeenCalledWith("file://compressed.jpg");
    append.mockRestore();
  });
});
