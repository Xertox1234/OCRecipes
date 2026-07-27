import { describe, it, expect, vi, beforeEach } from "vitest";

import { uploadCookbookCover } from "../cookbook-cover-upload";
import { ApiError } from "../api-error";

const { mockUploadAsync, mockCompressImage, mockCleanupImage, mockTokenGet } =
  vi.hoisted(() => ({
    mockUploadAsync: vi.fn(),
    mockCompressImage: vi.fn(),
    mockCleanupImage: vi.fn(),
    mockTokenGet: vi.fn(),
  }));

vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { MULTIPART: "multipart" },
}));

vi.mock("@/lib/image-compression", () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
  cleanupImage: (...args: unknown[]) => mockCleanupImage(...args),
}));

vi.mock("@/lib/query-client", () => ({
  getApiUrl: () => "https://api.test",
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: () => mockTokenGet() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockTokenGet.mockResolvedValue("jwt-token");
  mockCompressImage.mockResolvedValue({ uri: "file:///compressed.jpg" });
  mockCleanupImage.mockResolvedValue(undefined);
});

describe("uploadCookbookCover", () => {
  it("returns the updated cookbook on success", async () => {
    mockUploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ id: 7, name: "Sunday Bakes" }),
    });

    await expect(uploadCookbookCover(7, "file:///picked.jpg")).resolves.toEqual(
      { id: 7, name: "Sunday Bakes" },
    );
  });

  it("posts the compressed file to the cookbook's cover endpoint", async () => {
    mockUploadAsync.mockResolvedValue({ status: 200, body: "{}" });

    await uploadCookbookCover(7, "file:///picked.jpg");

    const [url, uri, options] = mockUploadAsync.mock.calls[0] as [
      string,
      string,
      { fieldName: string; headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.test/api/cookbooks/7/cover");
    // The compressed copy is uploaded, never the original asset.
    expect(uri).toBe("file:///compressed.jpg");
    expect(options.fieldName).toBe("cover");
    expect(options.headers.Authorization).toBe("Bearer jwt-token");
  });

  it("always cleans up the compressed copy, including on failure", async () => {
    mockUploadAsync.mockResolvedValue({ status: 500, body: "{}" });

    await expect(
      uploadCookbookCover(7, "file:///picked.jpg"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockCleanupImage).toHaveBeenCalledWith("file:///compressed.jpg");
  });

  it("preserves the server's machine-readable code so callers can branch", async () => {
    mockUploadAsync.mockResolvedValue({
      status: 429,
      body: JSON.stringify({ error: "slow down", code: "RATE_LIMITED" }),
    });

    await expect(
      uploadCookbookCover(7, "file:///picked.jpg"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("never leaks the raw server body into the error message", async () => {
    // Screens render static copy; the message must not become UI text.
    mockUploadAsync.mockResolvedValue({
      status: 400,
      body: JSON.stringify({ error: "column cover_image_url is null" }),
    });

    await expect(uploadCookbookCover(7, "file:///picked.jpg")).rejects.toThrow(
      "Upload failed: 400",
    );
  });

  it("tolerates a non-JSON error body", async () => {
    mockUploadAsync.mockResolvedValue({ status: 502, body: "<html>nope" });

    await expect(
      uploadCookbookCover(7, "file:///picked.jpg"),
    ).rejects.toMatchObject({ code: undefined });
  });

  it("throws when the response body is not valid JSON on success", async () => {
    mockUploadAsync.mockResolvedValue({ status: 200, body: "not json" });

    await expect(uploadCookbookCover(7, "file:///picked.jpg")).rejects.toThrow(
      "Invalid response from server",
    );
  });

  it("fails before compressing when there is no auth token", async () => {
    mockTokenGet.mockResolvedValue(null);

    await expect(uploadCookbookCover(7, "file:///picked.jpg")).rejects.toThrow(
      "Not authenticated",
    );
    expect(mockCompressImage).not.toHaveBeenCalled();
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});
