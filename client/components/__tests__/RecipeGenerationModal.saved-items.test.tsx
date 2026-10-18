// @vitest-environment jsdom
import React from "react";
import {
  screen,
  fireEvent,
  render,
  act,
  waitFor,
} from "@testing-library/react";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { setPendingGeneration } from "@/hooks/useGeneratedRecipeNotices";
import { RecipeGenerationModal } from "../RecipeGenerationModal";

const { mockStart } = vi.hoisted(() => ({ mockStart: vi.fn() }));
vi.mock("@/hooks/useGenerateRecipeInBackground", () => ({
  useGenerateRecipeInBackground: () => ({ start: mockStart }),
}));

// Tapping Generate hands the request to the background hook and closes the
// sheet at once (spec 2026-10-17 recipe-generate-argon-background-completion
// §5); the toast and Profile dot carry the result. One generation at a time.
describe("RecipeGenerationModal — Generate lets go", () => {
  function renderSheet(onClose = vi.fn()) {
    const { queryClient, wrapper } = createQueryWrapper();
    const utils = render(
      <RecipeGenerationModal visible onClose={onClose} productName="Oats" />,
      { wrapper },
    );
    return { queryClient, onClose, ...utils };
  }

  it("starts generation with the form values and closes the sheet immediately on Generate", () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByLabelText("Generate recipe"));

    expect(mockStart).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith({
      productName: "Oats",
      barcode: undefined,
      servings: 2,
      dietPreferences: [],
      timeConstraint: undefined,
      shareToPublic: false,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores a second tap in the same frame", () => {
    renderSheet();

    fireEvent.click(screen.getByLabelText("Generate recipe"));
    fireEvent.click(screen.getByLabelText("Generate recipe"));

    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("disables Generate with the pending caption while a generation is in flight", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setPendingGeneration(queryClient, "photo", true);

    render(
      <RecipeGenerationModal visible onClose={vi.fn()} productName="Oats" />,
      { wrapper },
    );

    await waitFor(() =>
      expect(
        screen
          .getByLabelText("A recipe is on its way")
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    expect(screen.getByText("A recipe is on its way")).toBeDefined();
    fireEvent.click(screen.getByLabelText("A recipe is on its way"));
    expect(mockStart).not.toHaveBeenCalled();
  });

  // A screen-reader user hears the label, not the visible text: "Generate
  // recipe, dimmed" never says why. The pending copy is the label too.
  it("names the pending state in the button's accessibility label", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setPendingGeneration(queryClient, "photo", true);

    render(
      <RecipeGenerationModal visible onClose={vi.fn()} productName="Oats" />,
      { wrapper },
    );

    await waitFor(() =>
      expect(screen.queryByLabelText("A recipe is on its way")).not.toBeNull(),
    );
    expect(screen.queryByLabelText("Generate recipe")).toBeNull();
  });

  it("re-enables Generate once the in-flight generation settles", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setPendingGeneration(queryClient, "photo", true);
    render(
      <RecipeGenerationModal visible onClose={vi.fn()} productName="Oats" />,
      { wrapper },
    );
    await waitFor(() =>
      expect(screen.queryByText("A recipe is on its way")).not.toBeNull(),
    );

    act(() => {
      setPendingGeneration(queryClient, "photo", false);
    });

    await waitFor(() =>
      expect(screen.queryByText("A recipe is on its way")).toBeNull(),
    );
    expect(
      screen.getByLabelText("Generate recipe").getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("resets the form on submit so reopening starts fresh", () => {
    const { rerender, onClose } = renderSheet();
    fireEvent.click(screen.getByLabelText("Vegan"));
    expect(screen.getByLabelText("Vegan").getAttribute("aria-checked")).toBe(
      "true",
    );

    fireEvent.click(screen.getByLabelText("Generate recipe"));
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ dietPreferences: ["Vegan"] }),
    );
    rerender(
      <RecipeGenerationModal visible onClose={onClose} productName="Oats" />,
    );

    expect(screen.getByLabelText("Vegan").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("no longer renders the waiting caption or an inline error banner", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setPendingGeneration(queryClient, "photo", true);
    render(
      <RecipeGenerationModal visible onClose={vi.fn()} productName="Oats" />,
      { wrapper },
    );
    await waitFor(() =>
      expect(screen.queryByText("A recipe is on its way")).not.toBeNull(),
    );

    expect(screen.queryByText(/This may take a few seconds/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Failed to generate recipe/)).toBeNull();
  });

  it("formats detected foods as the ingredient context", () => {
    const { wrapper } = createQueryWrapper();
    render(
      <RecipeGenerationModal
        visible
        onClose={vi.fn()}
        productName="Oats, Milk"
        foods={[
          { name: "Oats", quantity: "1 cup" },
          { name: "Milk", quantity: "200 ml" },
        ]}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByLabelText("Generate recipe"));

    const [input] = mockStart.mock.calls[0] as [{ productName: string }];
    expect(input.productName).not.toBe("Oats, Milk");
    expect(input.productName).toMatch(/Oats/);
    expect(input.productName).toMatch(/Milk/);
  });

  it("closes through the Close button even while a generation is in flight", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setPendingGeneration(queryClient, "photo", true);
    const onClose = vi.fn();
    render(
      <RecipeGenerationModal visible onClose={onClose} productName="Oats" />,
      { wrapper },
    );
    await waitFor(() =>
      expect(screen.queryByText("A recipe is on its way")).not.toBeNull(),
    );

    fireEvent.click(screen.getByLabelText("Close"));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
