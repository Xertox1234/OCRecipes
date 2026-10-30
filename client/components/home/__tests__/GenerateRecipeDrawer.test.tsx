// @vitest-environment jsdom
import React from "react";
import { act, screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { reactProps } from "../../../../test/utils/react-props";
import { GenerateRecipeDrawer } from "../GenerateRecipeDrawer";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection: vi.fn(), impact: vi.fn() }),
}));

describe("GenerateRecipeDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the prompt input by its visible floating label", () => {
    renderComponent(<GenerateRecipeDrawer onUsed={vi.fn()} />);
    // The floating label is drawn hidden from screen readers; the input's
    // accessible name must contain it (label-in-name).
    expect(screen.getByText("Recipe idea")).toBeTruthy();
    const input = screen.getByLabelText("Recipe idea");
    expect(input.tagName).toBe("INPUT");
  });

  it("sends the typed idea to recipe chat on Return", () => {
    const onUsed = vi.fn();
    renderComponent(<GenerateRecipeDrawer onUsed={onUsed} />);
    const input = screen.getByLabelText("Recipe idea");
    fireEvent.change(input, { target: { value: "quick curry" } });
    act(() => {
      (reactProps(input).onSubmitEditing as () => void)();
    });
    expect(onUsed).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith("RecipeChat", {
      initialMessage: "quick curry",
    });
  });
});
