import { describe, it, expect } from "vitest";

import {
  getSuggestionIconName,
  getSuggestionTypeLabel,
  mapSuggestionToSavedItemType,
} from "../suggestion-card-utils";

describe("suggestion-card-utils", () => {
  describe("getSuggestionIconName", () => {
    it("returns book-open for recipe", () => {
      expect(getSuggestionIconName("recipe")).toBe("book-open");
    });

    it("returns scissors for craft", () => {
      expect(getSuggestionIconName("craft")).toBe("scissors");
    });

    it("returns coffee for pairing", () => {
      expect(getSuggestionIconName("pairing")).toBe("coffee");
    });
  });

  describe("getSuggestionTypeLabel", () => {
    it("returns 'Kid Activity' for craft type", () => {
      expect(getSuggestionTypeLabel("craft")).toBe("Kid Activity");
    });

    it("returns type string for recipe", () => {
      expect(getSuggestionTypeLabel("recipe")).toBe("recipe");
    });

    it("returns type string for pairing", () => {
      expect(getSuggestionTypeLabel("pairing")).toBe("pairing");
    });
  });

  describe("mapSuggestionToSavedItemType", () => {
    it("maps craft to activity", () => {
      expect(mapSuggestionToSavedItemType("craft")).toBe("activity");
    });

    it("maps recipe to recipe", () => {
      expect(mapSuggestionToSavedItemType("recipe")).toBe("recipe");
    });

    it("maps pairing to recipe", () => {
      expect(mapSuggestionToSavedItemType("pairing")).toBe("recipe");
    });
  });
});
