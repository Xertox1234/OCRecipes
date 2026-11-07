import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];

const { storage } = vi.hoisted(() => ({
  storage: {
    listIdentities: vi.fn(),
    takeAppleTokensOnTicketsTargeting: vi.fn(),
    collectUserImageUrls: vi.fn(),
    deleteUser: vi.fn(),
    filterUnreferencedImageUrls: vi.fn(),
  },
}));
const { revokeAppleIdentities, invalidateTokenVersionCache, deleteImage } =
  vi.hoisted(() => ({
    revokeAppleIdentities: vi.fn(),
    invalidateTokenVersionCache: vi.fn(),
    deleteImage: vi.fn(),
  }));

vi.mock("../../storage", () => ({ storage }));
vi.mock("../auth-session", () => ({ revokeAppleIdentities }));
vi.mock("../../middleware/auth", () => ({ invalidateTokenVersionCache }));
vi.mock("../../lib/image-store", () => ({ deleteImage }));

const { deleteAccount } = await import("../account-deletion");

const appleIdentity = { provider: "apple", appleRefreshTokenEnc: "enc-id" };
const ownedImages = [
  { url: "https://cdn/x/recipe.jpg", kind: "recipe" },
  { url: "https://cdn/x/shared.jpg", kind: "recipe" },
];

/** Let the fire-and-forget cleanup chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  storage.listIdentities.mockImplementation(async () => {
    calls.push("listIdentities");
    return [appleIdentity];
  });
  storage.takeAppleTokensOnTicketsTargeting.mockImplementation(async () => {
    calls.push("takeTicketTokens");
    return ["enc-ticket"];
  });
  storage.collectUserImageUrls.mockImplementation(async () => {
    calls.push("collectImages");
    return ownedImages;
  });
  storage.deleteUser.mockImplementation(async () => {
    calls.push("deleteUser");
  });
  storage.filterUnreferencedImageUrls.mockImplementation(async () => {
    calls.push("filterImages");
    return [ownedImages[0]];
  });
  revokeAppleIdentities.mockImplementation(async (ids: unknown[]) => {
    calls.push(`revoke:${ids.length}`);
  });
  invalidateTokenVersionCache.mockImplementation(() => {
    calls.push("invalidateCache");
  });
  deleteImage.mockImplementation(async (url: string | null) => {
    calls.push(`deleteImage:${url}`);
  });
});

describe("deleteAccount", () => {
  it("revokes Apple tokens and collects images BEFORE the delete, invalidates the cache after, and cleans blobs last", async () => {
    await deleteAccount({ id: "u1", avatarUrl: "https://cdn/a/me.jpg" });
    await settle();

    expect(calls.slice(0, 7)).toEqual([
      "listIdentities",
      "revoke:1",
      "takeTicketTokens",
      "revoke:1",
      "collectImages",
      "deleteUser",
      "invalidateCache",
    ]);
    // Blob cleanup only after the rows are gone.
    const afterDelete = calls.slice(calls.indexOf("deleteUser") + 1);
    expect(afterDelete).toContain("deleteImage:https://cdn/a/me.jpg");
    expect(afterDelete).toContain("filterImages");
    expect(
      calls.indexOf("deleteImage:https://cdn/x/recipe.jpg"),
    ).toBeGreaterThan(calls.indexOf("filterImages"));
  });

  it("revokes the ticket tokens as Apple identities", async () => {
    await deleteAccount({ id: "u1", avatarUrl: null });
    expect(storage.takeAppleTokensOnTicketsTargeting).toHaveBeenCalledWith(
      "u1",
    );
    expect(revokeAppleIdentities).toHaveBeenNthCalledWith(2, [
      { provider: "apple", appleRefreshTokenEnc: "enc-ticket" },
    ]);
  });

  it("deletes only the images no other account still references", async () => {
    await deleteAccount({ id: "u1", avatarUrl: null });
    await settle();
    expect(storage.filterUnreferencedImageUrls).toHaveBeenCalledWith(
      ownedImages,
    );
    expect(deleteImage).toHaveBeenCalledWith(
      "https://cdn/x/recipe.jpg",
      "recipe",
    );
    expect(deleteImage).not.toHaveBeenCalledWith(
      "https://cdn/x/shared.jpg",
      expect.anything(),
    );
  });

  it("resolves before the blob cleanup finishes (cleanup never blocks the response)", async () => {
    let release!: () => void;
    storage.filterUnreferencedImageUrls.mockImplementation(
      () => new Promise((r) => (release = () => r([]))),
    );
    await expect(
      deleteAccount({ id: "u1", avatarUrl: null }),
    ).resolves.toBeUndefined();
    release();
  });
});
