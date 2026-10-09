// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeGenerationModal } from "../RecipeGenerationModal";

vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));

function tiles() {
  return [
    ...screen.queryAllByRole("radio"),
    ...screen.queryAllByRole("checkbox"),
  ];
}

// Servings, time and diet options are SelectableTiles: the tile ticks, so
// the modal must not tick again — one buzz per pick.
describe("RecipeGenerationModal — one selection tick per pick", () => {
  it("every servings, time and diet option ticks once", () => {
    renderComponent(
      <RecipeGenerationModal
        visible
        onClose={vi.fn()}
        onComplete={vi.fn()}
        productName="Oats"
      />,
    );
    const count = tiles().length;
    // Denominator: the modal must actually render its options.
    expect(count).toBeGreaterThan(10);

    for (let i = 0; i < count; i++) {
      vi.mocked(Haptics.selectionAsync).mockClear();
      vi.mocked(Haptics.impactAsync).mockClear();
      fireEvent.click(tiles()[i]);
      expect(
        vi.mocked(Haptics.selectionAsync).mock.calls.length,
        `tile ${i}`,
      ).toBe(1);
      expect(
        vi.mocked(Haptics.impactAsync),
        `tile ${i}`,
      ).not.toHaveBeenCalled();
    }
  });
});
