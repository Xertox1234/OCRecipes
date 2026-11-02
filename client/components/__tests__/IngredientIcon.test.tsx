// @vitest-environment jsdom
import React from "react";
import { renderComponent } from "../../../test/utils/render-component";
import { IngredientIcon } from "../IngredientIcon";

const { getIngredientIcon } = vi.hoisted(() => ({
  getIngredientIcon: vi.fn(),
}));
vi.mock("@/lib/ingredient-icon", () => ({
  getIngredientIcon,
  getCategoryIcon: () => null,
}));

// The icon sits beside the ingredient's name, so it is decorative: as its own
// VoiceOver/TalkBack stop it reads as an empty element on every ingredient row.
describe("IngredientIcon — hidden from screen readers", () => {
  it("hides the image icon", () => {
    getIngredientIcon.mockReturnValue({ uri: "garlic.png" });
    const { container } = renderComponent(<IngredientIcon name="garlic" />);
    expect(
      (container.firstChild as HTMLElement).getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("hides the fallback circle when no icon matches", () => {
    getIngredientIcon.mockReturnValue(null);
    const { container } = renderComponent(<IngredientIcon name="zzz" />);
    expect(
      (container.firstChild as HTMLElement).getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
