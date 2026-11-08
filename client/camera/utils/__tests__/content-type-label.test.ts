import { describe, it, expect } from "vitest";
import { getContentTypeLabel } from "../content-type-label";

describe("getContentTypeLabel", () => {
  it("returns readable labels for all content types", () => {
    expect(getContentTypeLabel("prepared_meal")).toBe("Meal");
    expect(getContentTypeLabel("nutrition_label")).toBe("Nutrition label");
    expect(getContentTypeLabel("restaurant_menu")).toBe("Restaurant menu");
    expect(getContentTypeLabel("raw_ingredients")).toBe("Ingredients");
    expect(getContentTypeLabel("grocery_receipt")).toBe("Grocery receipt");
    expect(getContentTypeLabel("restaurant_receipt")).toBe(
      "Restaurant receipt",
    );
    expect(getContentTypeLabel("non_food")).toBe("Not food");
    expect(getContentTypeLabel("has_barcode")).toBe("Barcode");
  });
});
