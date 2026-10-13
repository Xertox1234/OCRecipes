import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InspiredSuggestionRow } from "@shared/schema";
import { storage } from "../../storage";
import { deleteImage } from "../../lib/image-store";
import { purgeExpiredInspiredSuggestions } from "../purge-inspired-suggestions";

vi.mock("../../storage", () => ({
  storage: {
    listExpiredUnmadeSuggestions: vi.fn(),
    deleteInspiredSuggestions: vi.fn(),
  },
}));
vi.mock("../../lib/image-store", () => ({ deleteImage: vi.fn() }));

function card(id: number, imageUrl: string | null): InspiredSuggestionRow {
  const at = new Date("2026-10-01T00:00:00Z");
  return {
    id,
    userId: "u1",
    title: `Card ${id}`,
    description: "d",
    totalMinutes: 20,
    tags: [],
    imageUrl,
    makingStartedAt: null,
    madeRecipeId: null,
    createdAt: at,
    expiresAt: at,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("purgeExpiredInspiredSuggestions", () => {
  it("deletes rows then their images, in batches until empty", async () => {
    vi.mocked(storage.listExpiredUnmadeSuggestions)
      .mockResolvedValueOnce([card(1, "https://img/a.jpg"), card(2, null)])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.deleteInspiredSuggestions).mockResolvedValue([
      { id: 1, imageUrl: "https://img/a.jpg" },
      { id: 2, imageUrl: null },
    ]);
    const out = await purgeExpiredInspiredSuggestions(new Date(), 2);
    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith("https://img/a.jpg", "recipe");
    expect(storage.deleteInspiredSuggestions).toHaveBeenCalledWith([1, 2]);
    expect(out).toEqual({ rows: 2, images: 1 });
  });

  it("keeps the photo of a listed card that was claimed before the delete", async () => {
    vi.mocked(storage.listExpiredUnmadeSuggestions)
      .mockResolvedValueOnce([
        card(1, "https://img/made.jpg"),
        card(2, "https://img/gone.jpg"),
      ])
      .mockResolvedValueOnce([]);
    // card 1 was made in the race window: the delete skips it
    vi.mocked(storage.deleteInspiredSuggestions).mockResolvedValue([
      { id: 2, imageUrl: "https://img/gone.jpg" },
    ]);
    const out = await purgeExpiredInspiredSuggestions(new Date(), 10);
    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith("https://img/gone.jpg", "recipe");
    expect(out).toEqual({ rows: 1, images: 1 });
  });

  it("keeps going when one image delete fails", async () => {
    vi.mocked(storage.listExpiredUnmadeSuggestions)
      .mockResolvedValueOnce([card(1, "x")])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteImage).mockRejectedValueOnce(new Error("r2"));
    vi.mocked(storage.deleteInspiredSuggestions).mockResolvedValue([
      { id: 1, imageUrl: "x" },
    ]);
    const out = await purgeExpiredInspiredSuggestions(new Date(), 10);
    expect(out).toEqual({ rows: 1, images: 0 });
  });
});
