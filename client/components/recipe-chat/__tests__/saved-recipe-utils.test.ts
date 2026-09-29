import { describe, it, expect } from "vitest";
import { savedRecipeIdFromMetadata } from "../saved-recipe-utils";

// The chat save route writes { savedRecipeId } back into the assistant
// message's metadata (server/storage/recipe-from-chat.ts), so a chat reopened
// later still knows which community recipe a card was saved as.
describe("savedRecipeIdFromMetadata", () => {
  it("reads the saved community recipe id", () => {
    expect(
      savedRecipeIdFromMetadata({ metadataVersion: 1, savedRecipeId: 88 }),
    ).toBe(88);
  });

  it("is null when the recipe was never saved", () => {
    expect(savedRecipeIdFromMetadata({ metadataVersion: 1 })).toBeNull();
    expect(savedRecipeIdFromMetadata(null)).toBeNull();
    expect(savedRecipeIdFromMetadata(undefined)).toBeNull();
  });

  it("ignores anything that isn't a positive integer id", () => {
    expect(savedRecipeIdFromMetadata({ savedRecipeId: "88" })).toBeNull();
    expect(savedRecipeIdFromMetadata({ savedRecipeId: 0 })).toBeNull();
    expect(savedRecipeIdFromMetadata({ savedRecipeId: -3 })).toBeNull();
    expect(savedRecipeIdFromMetadata({ savedRecipeId: 1.5 })).toBeNull();
  });
});
