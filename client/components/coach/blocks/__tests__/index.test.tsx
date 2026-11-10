// @vitest-environment jsdom
/**
 * BlockRenderer dispatch tests — verifies each block.type routes to the right
 * child component and that unknown types render nothing (default branch).
 * Child cards are mocked to thin doubles so this isolates the switch logic.
 */
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FadeInUp } from "react-native-reanimated";
import { renderComponent } from "../../../../../test/utils/render-component";
import BlockRenderer from "../index";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const { a11y } = vi.hoisted(() => ({ a11y: { reducedMotion: false } }));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

vi.mock("../ActionCard", () => ({
  default: () => <div data-testid="r-action" />,
}));
vi.mock("../SuggestionList", () => ({
  default: () => <div data-testid="r-suggestion" />,
}));
vi.mock("../InlineChart", () => ({
  default: () => <div data-testid="r-chart" />,
}));
vi.mock("../CommitmentCard", () => ({
  default: () => <div data-testid="r-commitment" />,
}));
vi.mock("../QuickReplies", () => ({
  default: (p: { animateEntry?: boolean; entryDelayMs?: number }) => (
    <div
      data-testid="r-quick"
      data-animate={String(!!p.animateEntry)}
      data-delay={String(p.entryDelayMs ?? "")}
    />
  ),
}));
vi.mock("../RecipeCard", () => ({
  default: () => <div data-testid="r-recipe" />,
}));
vi.mock("../MealPlanCard", () => ({
  default: () => <div data-testid="r-mealplan" />,
}));
vi.mock("@/components/recipe-finder/RecipeFinderMessage", () => ({
  RecipeFinderMessage: ({ isActive }: { isActive: boolean }) => (
    <div data-testid="r-finder" data-active={String(isActive)} />
  ),
}));

const blocks: Record<string, CoachBlock> = {
  action_card: {
    type: "action_card",
    title: "t",
    subtitle: "s",
    actionLabel: "go",
    action: { type: "set_goal", goalType: "calories" },
  },
  suggestion_list: { type: "suggestion_list", items: [] },
  inline_chart: {
    type: "inline_chart",
    chartType: "stat_row",
    title: "c",
    data: [],
  },
  commitment_card: {
    type: "commitment_card",
    title: "c",
    followUpText: "f",
    followUpDate: "2026-06-01",
  },
  quick_replies: { type: "quick_replies", options: [] },
  recipe_card: {
    type: "recipe_card",
    recipe: {
      title: "r",
      calories: 1,
      protein: 1,
      prepTime: "1 min",
      imageUrl: null,
      recipeId: 1,
      source: "community",
    },
  },
  meal_plan_card: { type: "meal_plan_card", title: "m", days: [] },
};

describe("BlockRenderer", () => {
  it.each([
    ["action_card", "r-action"],
    ["suggestion_list", "r-suggestion"],
    ["inline_chart", "r-chart"],
    ["commitment_card", "r-commitment"],
    ["quick_replies", "r-quick"],
    ["recipe_card", "r-recipe"],
    ["meal_plan_card", "r-mealplan"],
  ])("renders the %s block", (type, testId) => {
    renderComponent(<BlockRenderer block={blocks[type]} />);
    expect(screen.getByTestId(testId)).toBeTruthy();
  });

  const finderFlow = {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "results" as const,
    request: "x",
    query: { q: "x" },
    round: 0 as const,
    shownIds: [],
  };
  it.each([
    [
      {
        type: "recipe_results",
        source: "community",
        items: [],
        actions: [],
        notice: null,
        flow: finderFlow,
      },
    ],
    [
      {
        type: "recipe_questions",
        questions: [{ question: "Q?", options: ["a", "b"] }],
        flow: { ...finderFlow, stage: "clarifying" },
      },
    ],
  ] as [CoachBlock][])(
    "renders a finder block with the shared component",
    (block) => {
      renderComponent(<BlockRenderer block={block} isActive />);
      expect(screen.getByTestId("r-finder").getAttribute("data-active")).toBe(
        "true",
      );
    },
  );

  it("renders nothing for an unknown block type (default branch)", () => {
    const { container } = renderComponent(
      <BlockRenderer block={{ type: "mystery" } as unknown as CoachBlock} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BlockRenderer — entrance", () => {
  const card = blocks.action_card;
  const quickReplies = {
    type: "quick_replies",
    options: [{ label: "Yes", message: "Yes" }],
  } as unknown as CoachBlock;

  let delay: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    a11y.reducedMotion = false;
    delay = vi.spyOn(
      FadeInUp as unknown as { delay: (ms: number) => unknown },
      "delay",
    );
  });
  afterEach(() => {
    delay.mockRestore();
  });

  // Positive control: the live footer copy fades in on its beat.
  it("fades in after its stagger delay when asked", () => {
    renderComponent(
      <BlockRenderer block={card} animateEntry entryDelayMs={90} />,
    );
    expect(delay).toHaveBeenCalledWith(90);
    expect(screen.getByTestId("r-action")).toBeTruthy();
  });

  // Each chip of a quick-reply row enters on its own beat, so the row
  // takes the entrance over instead of fading in as one piece.
  it("hands a quick-reply row its entrance to stagger chip by chip", () => {
    renderComponent(
      <BlockRenderer block={quickReplies} animateEntry entryDelayMs={45} />,
    );
    const row = screen.getByTestId("r-quick");
    expect(row.getAttribute("data-animate")).toBe("true");
    expect(row.getAttribute("data-delay")).toBe("45");
    expect(delay).not.toHaveBeenCalled();
  });

  // Saved messages (history, scroll-back, the swap after a reply) appear
  // without replaying an entrance.
  it("does not animate by default", () => {
    renderComponent(<BlockRenderer block={card} />);
    renderComponent(<BlockRenderer block={quickReplies} />);
    expect(delay).not.toHaveBeenCalled();
    expect(screen.getByTestId("r-quick").getAttribute("data-animate")).toBe(
      "false",
    );
  });

  it("does not animate under reduced motion", () => {
    a11y.reducedMotion = true;
    renderComponent(<BlockRenderer block={card} animateEntry />);
    renderComponent(<BlockRenderer block={quickReplies} animateEntry />);
    expect(delay).not.toHaveBeenCalled();
    expect(screen.getByTestId("r-quick").getAttribute("data-animate")).toBe(
      "false",
    );
  });

  it("still renders nothing for an unknown block type", () => {
    const { container } = renderComponent(
      <BlockRenderer
        block={{ type: "mystery" } as unknown as CoachBlock}
        animateEntry
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BlockRenderer write_card", () => {
  it("renders a write card and reports edits with its card id", () => {
    const onWriteCardEdit = vi.fn();
    renderComponent(
      <BlockRenderer
        block={{
          type: "write_card",
          cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          kind: "food",
          status: "live",
          payload: {
            items: [
              {
                name: "Large eggs",
                unitLabel: "egg",
                perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
                count: 2,
                source: "lookup",
              },
            ],
            mealType: "breakfast",
            day: "today",
          },
        }}
        onWriteCardEdit={onWriteCardEdit}
      />,
    );
    expect(screen.getByRole("button", { name: "Log 144 cal" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "More Large eggs" }));
    expect(onWriteCardEdit).toHaveBeenCalledWith(
      "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      { counts: [3] },
    );
  });
});

describe("BlockRenderer — checked_trail", () => {
  it("draws a checked_trail block as the trail line", () => {
    renderComponent(
      <BlockRenderer
        block={{ type: "checked_trail", items: ["today's log"] }}
      />,
    );
    expect(screen.getByText("Checked: today's log")).toBeTruthy();
  });
});
