import { describe, it, expect } from "vitest";
import { RECIPE_IMPORT_OPTIONS } from "../recipe-import-options";

describe("recipe-import-options", () => {
  it("has exactly the 4 expected keys, no duplicates", () => {
    const keys = RECIPE_IMPORT_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(["camera", "clipboard", "gallery", "url"]);
  });

  it("every option has non-empty title, desc, and icon", () => {
    for (const option of RECIPE_IMPORT_OPTIONS) {
      expect(
        option.title.length,
        `title empty for "${option.key}"`,
      ).toBeGreaterThan(0);
      expect(
        option.desc.length,
        `desc empty for "${option.key}"`,
      ).toBeGreaterThan(0);
      expect(
        option.icon.length,
        `icon empty for "${option.key}"`,
      ).toBeGreaterThan(0);
    }
  });
});
