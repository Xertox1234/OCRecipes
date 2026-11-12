import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockImage, mockFs, mockLogger } = vi.hoisted(() => ({
  mockImage: {
    clearMemoryCache: vi.fn(),
    clearDiskCache: vi.fn(),
  },
  mockFs: {
    cacheDirectory: "file:///cache/" as string | null,
    readDirectoryAsync: vi.fn(),
    deleteAsync: vi.fn(),
  },
  mockLogger: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock("expo-image", () => ({ Image: mockImage }));
vi.mock("expo-file-system/legacy", () => ({
  get cacheDirectory() {
    return mockFs.cacheDirectory;
  },
  readDirectoryAsync: (...a: unknown[]) => mockFs.readDirectoryAsync(...a),
  deleteAsync: (...a: unknown[]) => mockFs.deleteAsync(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

const { clearDeviceImageLeftovers, CLIPBOARD_TEMP_PREFIX } = await import(
  "../device-leftovers"
);

// Privacy audit 2026-11-10, L4: sign-out and account deletion left the image
// disk cache and pasted-picture temp files on the device.
describe("clearDeviceImageLeftovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.cacheDirectory = "file:///cache/";
    mockImage.clearMemoryCache.mockResolvedValue(true);
    mockImage.clearDiskCache.mockResolvedValue(true);
    mockFs.readDirectoryAsync.mockResolvedValue([]);
    mockFs.deleteAsync.mockResolvedValue(undefined);
  });

  it("clears the image cache in memory and on disk", async () => {
    await clearDeviceImageLeftovers();
    expect(mockImage.clearMemoryCache).toHaveBeenCalledTimes(1);
    expect(mockImage.clearDiskCache).toHaveBeenCalledTimes(1);
  });

  it("deletes pasted-picture temp files and nothing else in the cache folder", async () => {
    mockFs.readDirectoryAsync.mockResolvedValue([
      `${CLIPBOARD_TEMP_PREFIX}1731400000000.jpg`,
      "ImagePicker",
      "other_clipboard_recipe_1.jpg",
      `${CLIPBOARD_TEMP_PREFIX}1731400000001.jpg`,
    ]);

    await clearDeviceImageLeftovers();

    expect(mockFs.readDirectoryAsync).toHaveBeenCalledWith("file:///cache/");
    expect(mockFs.deleteAsync.mock.calls).toEqual([
      [
        "file:///cache/clipboard_recipe_1731400000000.jpg",
        { idempotent: true },
      ],
      [
        "file:///cache/clipboard_recipe_1731400000001.jpg",
        { idempotent: true },
      ],
    ]);
  });

  it("still sweeps the temp files when the image cache clear throws", async () => {
    mockImage.clearMemoryCache.mockRejectedValue(new Error("no module"));
    mockImage.clearDiskCache.mockRejectedValue(new Error("no module"));
    mockFs.readDirectoryAsync.mockResolvedValue([
      `${CLIPBOARD_TEMP_PREFIX}1.jpg`,
    ]);

    await expect(clearDeviceImageLeftovers()).resolves.toBeUndefined();

    expect(mockFs.deleteAsync).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("one file that cannot be deleted does not stop the others, and never throws", async () => {
    mockFs.readDirectoryAsync.mockResolvedValue([
      `${CLIPBOARD_TEMP_PREFIX}1.jpg`,
      `${CLIPBOARD_TEMP_PREFIX}2.jpg`,
    ]);
    mockFs.deleteAsync.mockRejectedValueOnce(new Error("busy"));

    await expect(clearDeviceImageLeftovers()).resolves.toBeUndefined();

    expect(mockFs.deleteAsync).toHaveBeenCalledTimes(2);
  });

  it("never throws when the cache folder cannot be listed", async () => {
    mockFs.readDirectoryAsync.mockRejectedValue(new Error("gone"));
    await expect(clearDeviceImageLeftovers()).resolves.toBeUndefined();
  });

  it("skips the file sweep where there is no cache folder (web)", async () => {
    mockFs.cacheDirectory = null;
    await clearDeviceImageLeftovers();
    expect(mockFs.readDirectoryAsync).not.toHaveBeenCalled();
  });
});
