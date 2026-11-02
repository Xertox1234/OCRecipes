// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeMetaChips } from "../RecipeMetaChips";

// Each pill's icon sits beside text that already says what it is, so the icon
// is decorative: left in the tree it is a VoiceOver/TalkBack stop with no label.
describe("RecipeMetaChips — decorative icons", () => {
  it("hides the time, difficulty and servings icons from screen readers", () => {
    const { container } = renderComponent(
      <RecipeMetaChips timeDisplay="30 min" difficulty="Easy" servings={4} />,
    );
    const icons = container.querySelectorAll("[data-icon]");
    expect(icons).toHaveLength(3);
    icons.forEach((icon) =>
      expect(icon.getAttribute("aria-hidden")).toBe("true"),
    );
  });

  it("keeps the pill text readable", () => {
    renderComponent(
      <RecipeMetaChips timeDisplay="30 min" difficulty="Easy" servings={4} />,
    );
    expect(screen.getByText("30 min")).toBeDefined();
    expect(screen.getByText("Easy")).toBeDefined();
    expect(screen.getByText("4 servings")).toBeDefined();
  });
});
