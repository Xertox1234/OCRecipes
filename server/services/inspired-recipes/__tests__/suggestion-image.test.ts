import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InspiredSuggestionRow } from "@shared/schema";

import { generateRecipeImage } from "../../recipe-generation";
import { deleteImage } from "../../../lib/image-store";
import { storage } from "../../../storage";
import { generateSuggestionImage } from "../suggestion-image";

vi.mock("../../recipe-generation", () => ({ generateRecipeImage: vi.fn() }));
vi.mock("../../../lib/image-store", () => ({ deleteImage: vi.fn() }));
vi.mock("../../../storage", () => ({
  storage: { setInspiredSuggestionImage: vi.fn() },
}));

const row: Pick<InspiredSuggestionRow, "id" | "title" | "tags"> = {
  id: 3,
  title: "Bean Tacos",
  tags: ["mexican"],
};

beforeEach(() => vi.clearAllMocks());

describe("generateSuggestionImage", () => {
  it("generates a small image without the art director and stores it", async () => {
    vi.mocked(generateRecipeImage).mockResolvedValue("https://img/x.jpg");
    vi.mocked(storage.setInspiredSuggestionImage).mockResolvedValue(true);
    await generateSuggestionImage(row);
    expect(generateRecipeImage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bean Tacos" }),
      { skipLLM: true, width: 768, height: 576 },
    );
    expect(storage.setInspiredSuggestionImage).toHaveBeenCalledWith(
      3,
      "https://img/x.jpg",
    );
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("deletes the new image if the row already had one (lost race)", async () => {
    vi.mocked(generateRecipeImage).mockResolvedValue("https://img/late.jpg");
    vi.mocked(storage.setInspiredSuggestionImage).mockResolvedValue(false);
    await generateSuggestionImage(row);
    expect(deleteImage).toHaveBeenCalledWith("https://img/late.jpg", "recipe");
  });

  it("does nothing when generation fails", async () => {
    vi.mocked(generateRecipeImage).mockResolvedValue(null);
    await generateSuggestionImage(row);
    expect(storage.setInspiredSuggestionImage).not.toHaveBeenCalled();
  });
});
