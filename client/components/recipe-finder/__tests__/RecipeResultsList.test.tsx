// @vitest-environment jsdom
import React from "react";
import * as RN from "react-native";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeResultsList } from "../RecipeResultsList";
import type {
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";

const mockPhotos = vi.hoisted(() => ({ current: new Map<number, string>() }));
vi.mock("@/hooks/useInspiredSuggestions", () => ({
  useSuggestionPhotos: () => mockPhotos.current,
}));

const block: RecipeResultsBlock = {
  type: "recipe_results",
  source: "community",
  items: [
    {
      id: 12,
      source: "community",
      title: "Mediterranean Quinoa Salad",
      imageUrl: null,
      readyInMinutes: 20,
      calories: 350,
    },
    {
      id: 13,
      source: "community",
      title: "Greek Bowl",
      imageUrl: "https://img/greek.jpg",
      readyInMinutes: null,
      calories: null,
    },
  ],
  actions: ["search_online", "generate", "none_of_these"],
  notice: null,
  flow: {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "results",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};

const inspiredItem: FinderItem = {
  id: 44,
  source: "inspired",
  title: "Smoky Chickpea Tacos",
  description: "Charred chickpeas, lime slaw, warm tortillas.",
  imageUrl: null,
  readyInMinutes: 25,
  calories: null,
};

describe("RecipeResultsList", () => {
  it("renders the header, rows with meta, and the three buttons", () => {
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(screen.getByText("From the community")).toBeDefined();
    expect(screen.getByText("20 min · 350 cal")).toBeDefined();
    expect(screen.getByRole("list")).toBeDefined();
    for (const name of ["Get ideas for you", "Generate", "None of these"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
  });

  it("uses a placeholder icon, never an empty box, when a row has no image", () => {
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("finder-thumb-placeholder")).toHaveLength(1);
  });

  it("each row is one labelled button that opens the recipe", () => {
    const onOpenItem = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={onOpenItem}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mediterranean Quinoa Salad, 20 minutes, 350 calories. Opens recipe.",
      }),
    );
    expect(onOpenItem).toHaveBeenCalledWith(block.items[0]);
  });

  it("fires the tapped button", () => {
    const onButton = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={onButton}
        onOpenItem={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(onButton).toHaveBeenCalledWith("generate");
  });

  it("an old list's buttons are disabled and announce as disabled; rows still open", () => {
    const onButton = vi.fn();
    const onOpenItem = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive={false}
        onButton={onButton}
        onOpenItem={onOpenItem}
      />,
    );
    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(generate);
    expect(onButton).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Greek Bowl. Opens recipe." }),
    );
    expect(onOpenItem).toHaveBeenCalled();
  });

  it("marks a locked button as a Premium feature", () => {
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        lockedButtons={["search_online"]}
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Get ideas for you. Premium feature",
      }),
    ).toBeDefined();
  });

  it("shows the unavailable notice instead of 'no results'", () => {
    renderComponent(
      <RecipeResultsList
        block={{
          ...block,
          source: "inspired",
          items: [],
          notice: "unavailable",
          actions: ["generate", "none_of_these"],
        }}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Ideas aren't available right now. Try Generate or a community pick.",
      ),
    ).toBeDefined();
  });

  it("announces 'Found N community recipes' once when active", () => {
    const spy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    const { rerender } = renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    rerender(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(spy).toHaveBeenCalledExactlyOnceWith("Found 2 community recipes");
    spy.mockRestore();
  });

  it("stays silent when announceArrival is false (RecipeChef's pending bubble)", () => {
    const spy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        announceArrival={false}
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("inspired rows show Make this mine and call onMakeItem", () => {
    const onMakeItem = vi.fn();
    const onOpenItem = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={{ ...block, source: "inspired", items: [inspiredItem] }}
        isActive
        onButton={vi.fn()}
        onOpenItem={onOpenItem}
        onMakeItem={onMakeItem}
        makingId={null}
        lockedButtons={[]}
        announceArrival={false}
      />,
    );
    expect(screen.getByText("Ideas for you")).toBeDefined();
    expect(screen.getByText(inspiredItem.description!)).toBeDefined();
    fireEvent.click(screen.getByLabelText(`Make ${inspiredItem.title} mine`));
    expect(onMakeItem).toHaveBeenCalledWith(inspiredItem);
    // An idea has no detail screen — the row itself never opens anything.
    expect(screen.queryByRole("button", { name: /Opens recipe/ })).toBeNull();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("an idea being made shows its button busy and ignores taps", () => {
    const onMakeItem = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={{ ...block, source: "inspired", items: [inspiredItem] }}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
        onMakeItem={onMakeItem}
        makingId={inspiredItem.id}
      />,
    );
    const button = screen.getByLabelText(`Make ${inspiredItem.title} mine`);
    fireEvent.click(button);
    expect(onMakeItem).not.toHaveBeenCalled();
  });

  it("an idea's photo comes from the polled suggestion photos", () => {
    mockPhotos.current = new Map([[inspiredItem.id, "https://img/taco.jpg"]]);
    renderComponent(
      <RecipeResultsList
        block={{ ...block, source: "inspired", items: [inspiredItem] }}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
        onMakeItem={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("finder-thumb-placeholder")).toBeNull();
    mockPhotos.current = new Map();
  });
});
