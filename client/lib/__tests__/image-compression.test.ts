import { compressImage, cleanupImage } from "../image-compression";

const { mockManipulateAsync, mockGetInfoAsync, mockDeleteAsync, mockGetSize } =
  vi.hoisted(() => ({
    mockManipulateAsync: vi.fn(),
    mockGetInfoAsync: vi.fn(),
    mockDeleteAsync: vi.fn(),
    mockGetSize: vi.fn(),
  }));

vi.mock("react-native", () => ({
  Image: { getSize: (...args: unknown[]) => mockGetSize(...args) },
}));

vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: "jpeg" },
}));

vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));

describe("compressImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A 4:3 landscape camera photo unless a test says otherwise.
    mockGetSize.mockResolvedValue({ width: 4032, height: 3024 });
    mockDeleteAsync.mockResolvedValue(undefined);
  });

  it("resizes and compresses with default options", async () => {
    mockManipulateAsync.mockResolvedValue({
      uri: "file://compressed.jpg",
      width: 1024,
      height: 768,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500 * 1024 }); // 500KB

    const result = await compressImage("file://original.jpg");

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      "file://original.jpg",
      [{ resize: { width: 1024 } }],
      { compress: 0.7, format: "jpeg" },
    );
    expect(result).toEqual({
      uri: "file://compressed.jpg",
      width: 1024,
      height: 768,
      sizeKB: 500,
    });
  });

  it("applies custom options", async () => {
    mockManipulateAsync.mockResolvedValue({
      uri: "file://small.jpg",
      width: 512,
      height: 512,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 200 * 1024 });

    await compressImage("file://orig.jpg", {
      maxWidth: 512,
      maxHeight: 512,
      quality: 0.5,
    });

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      "file://orig.jpg",
      [{ resize: { width: 512 } }],
      { compress: 0.5, format: "jpeg" },
    );
  });

  it("does adaptive quality reduction when image exceeds target size", async () => {
    // First pass: too large (1200KB > 900KB target)
    mockManipulateAsync
      .mockResolvedValueOnce({
        uri: "file://pass1.jpg",
        width: 1024,
        height: 768,
      })
      .mockResolvedValueOnce({
        uri: "file://pass2.jpg",
        width: 1024,
        height: 768,
      });
    mockGetInfoAsync
      .mockResolvedValueOnce({ exists: true, size: 1200 * 1024 })
      .mockResolvedValueOnce({ exists: true, size: 800 * 1024 });

    const result = await compressImage("file://large.jpg");

    // Should be called twice (initial + adaptive)
    expect(mockManipulateAsync).toHaveBeenCalledTimes(2);
    // Second call should have reduced quality: 0.7 * (900/1200) = 0.525
    const secondCall = mockManipulateAsync.mock.calls[1];
    expect(secondCall[2].compress).toBeCloseTo(0.525, 2);
    expect(result.uri).toBe("file://pass2.jpg");
    expect(result.sizeKB).toBe(800);
    // The second pass keeps the aspect ratio too
    expect(secondCall[1]).toEqual([{ resize: { width: 1024 } }]);
    // The discarded first-pass file is deleted, not left in the cache
    expect(mockDeleteAsync).toHaveBeenCalledWith("file://pass1.jpg", {
      idempotent: true,
    });
  });

  it("clamps adaptive quality to minimum 0.3", async () => {
    // Very large file that would push quality below 0.3
    mockManipulateAsync
      .mockResolvedValueOnce({
        uri: "file://huge1.jpg",
        width: 1024,
        height: 768,
      })
      .mockResolvedValueOnce({
        uri: "file://huge2.jpg",
        width: 1024,
        height: 768,
      });
    mockGetInfoAsync
      .mockResolvedValueOnce({ exists: true, size: 5000 * 1024 }) // 5MB
      .mockResolvedValueOnce({ exists: true, size: 1500 * 1024 });

    await compressImage("file://huge.jpg");

    const secondCall = mockManipulateAsync.mock.calls[1];
    // 0.7 * (900/5000) = 0.126, clamped to 0.3
    expect(secondCall[2].compress).toBe(0.3);
  });

  it("skips adaptive pass when quality is already at 0.3", async () => {
    mockManipulateAsync.mockResolvedValue({
      uri: "file://compressed.jpg",
      width: 1024,
      height: 768,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1200 * 1024 });

    await compressImage("file://test.jpg", { quality: 0.3 });

    // Only one pass since quality <= 0.3
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
  });

  // Passing both width and height makes expo-image-manipulator scale to
  // exactly that box, stretching the photo (audit 2026-10-29 H-cam-1).
  it("bounds a portrait photo by its height so it keeps its shape", async () => {
    mockGetSize.mockResolvedValue({ width: 3024, height: 4032 });
    mockManipulateAsync.mockResolvedValue({
      uri: "file://p.jpg",
      width: 768,
      height: 1024,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 300 * 1024 });

    await compressImage("file://portrait.jpg", {
      maxWidth: 1536,
      maxHeight: 1536,
    });

    expect(mockManipulateAsync.mock.calls[0][1]).toEqual([
      { resize: { height: 1536 } },
    ]);
  });

  it("does not upscale a photo already inside the bounds", async () => {
    mockGetSize.mockResolvedValue({ width: 640, height: 480 });
    mockManipulateAsync.mockResolvedValue({
      uri: "file://s.jpg",
      width: 640,
      height: 480,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 80 * 1024 });

    await compressImage("file://small.jpg");

    expect(mockManipulateAsync.mock.calls[0][1]).toEqual([]);
  });

  it("still keeps the aspect ratio when the source size can't be read", async () => {
    mockGetSize.mockRejectedValue(new Error("unreadable"));
    mockManipulateAsync.mockResolvedValue({
      uri: "file://u.jpg",
      width: 1024,
      height: 768,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 300 * 1024 });

    await compressImage("file://unknown.jpg");

    expect(mockManipulateAsync.mock.calls[0][1]).toEqual([
      { resize: { width: 1024 } },
    ]);
  });

  it("handles non-existent file info gracefully", async () => {
    mockManipulateAsync.mockResolvedValue({
      uri: "file://result.jpg",
      width: 800,
      height: 600,
    });
    mockGetInfoAsync.mockResolvedValue({ exists: false });

    const result = await compressImage("file://missing.jpg");

    expect(result.sizeKB).toBe(0);
  });
});

describe("cleanupImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the image file with idempotent flag", async () => {
    mockDeleteAsync.mockResolvedValue(undefined);

    await cleanupImage("file://temp.jpg");

    expect(mockDeleteAsync).toHaveBeenCalledWith("file://temp.jpg", {
      idempotent: true,
    });
  });

  it("silently ignores delete errors", async () => {
    mockDeleteAsync.mockRejectedValue(new Error("Permission denied"));

    // Should not throw
    await expect(cleanupImage("file://locked.jpg")).resolves.toBeUndefined();
  });
});
