// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachDashboard from "../CoachDashboard";
import type { CoachContextData } from "@/hooks/useCoachContext";

vi.mock("@/lib/feature-tips-storage", () => ({
  hasUsedFeature: () => true,
}));

const { mockKeyboardDismiss } = vi.hoisted(() => ({
  mockKeyboardDismiss: vi.fn(),
}));

// The shared react-native mock has no Keyboard; Expand-while-typing closes it.
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Keyboard: { dismiss: mockKeyboardDismiss },
}));

const mockFold = vi.hoisted(() => ({
  cached: null as boolean | null,
  load: vi.fn<() => Promise<boolean>>(),
  save: vi.fn<(folded: boolean) => void>(),
}));

vi.mock("@/lib/coach-dashboard-fold-storage", () => ({
  getCachedCoachDashboardFolded: () => mockFold.cached,
  loadCoachDashboardFolded: mockFold.load,
  setCoachDashboardFolded: mockFold.save,
}));

beforeEach(() => {
  mockKeyboardDismiss.mockClear();
  mockFold.cached = null;
  mockFold.load.mockReset().mockResolvedValue(false);
  mockFold.save.mockReset();
});

type NotebookEntry = CoachContextData["notebook"][number];

const context: CoachContextData = {
  goals: { calories: 1949, protein: 146, carbs: 200, fat: 60 },
  todayIntake: {
    totalCalories: 420,
    totalProtein: 12,
    totalCarbs: 40,
    totalFat: 10,
  },
  dietaryProfile: null,
  notebook: [
    {
      id: 1,
      type: "insight",
      content: "Pumpkin seeds add iron",
    } as NotebookEntry,
  ],
  dueCommitments: [],
  suggestions: ["How was my week?"],
};

function renderDashboard(onNotebookPress = vi.fn()) {
  renderComponent(
    <CoachDashboard
      context={context}
      onSuggestionPress={vi.fn()}
      onNotebookPress={onNotebookPress}
    />,
  );
  return onNotebookPress;
}

describe("CoachDashboard", () => {
  it("opens with the stats, tips and suggestions showing", () => {
    renderDashboard();
    expect(screen.getByText("Calories")).toBeTruthy();
    expect(screen.getByText("Pumpkin seeds add iron")).toBeTruthy();
    expect(screen.getByText("How was my week?")).toBeTruthy();
  });

  // Tapping a tip sends it as the user's first message, and the server titles
  // a new thread from that message — the raw third-person note ("The user has
  // logged…") became a thread title on the demo account, 2026-11-02.
  it("tapping a tip sends the text the row shows, not the raw note", () => {
    const onSuggestionPress = vi.fn();
    renderComponent(
      <CoachDashboard
        context={{
          ...context,
          notebook: [
            {
              id: 2,
              type: "insight",
              content: "The user has logged 0.7g of protein today",
            } as NotebookEntry,
          ],
        }}
        onSuggestionPress={onSuggestionPress}
        onNotebookPress={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discuss: You have logged 0.7g of protein today",
      }),
    );
    expect(onSuggestionPress).toHaveBeenCalledWith(
      "You have logged 0.7g of protein today",
    );
  });

  it("the top row always carries today's calories against the goal", () => {
    renderDashboard();
    expect(screen.getByText("420 / 1,949 cal")).toBeTruthy();
  });

  // Folding must free the room for the chat: everything below the top row
  // goes, the stat boxes included.
  it("folding leaves only the top row", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Collapse dashboard" }));

    expect(screen.queryByText("Calories")).toBeNull();
    expect(screen.queryByText("Pumpkin seeds add iron")).toBeNull();
    expect(screen.queryByText("How was my week?")).toBeNull();
    expect(screen.getByText("420 / 1,949 cal")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand dashboard" }),
    ).toBeTruthy();
  });

  // The card opened on every visit, so the chat started at half the screen
  // even for someone who always folds it (owner, 2026-11-07).
  describe("remembering the fold", () => {
    it("folding saves the choice, opening saves it too", () => {
      renderDashboard();
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse dashboard" }),
      );
      expect(mockFold.save).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByRole("button", { name: "Expand dashboard" }));
      expect(mockFold.save).toHaveBeenLastCalledWith(false);
    });

    it("opens folded at once when the choice is already known", () => {
      mockFold.cached = true;
      renderDashboard();
      expect(screen.queryByText("Calories")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Expand dashboard" }),
      ).toBeTruthy();
      expect(mockFold.load).not.toHaveBeenCalled();
    });

    it("folds once a saved fold is read from the device", async () => {
      mockFold.load.mockResolvedValue(true);
      renderDashboard();
      expect(
        await screen.findByRole("button", { name: "Expand dashboard" }),
      ).toBeTruthy();
      expect(screen.queryByText("Calories")).toBeNull();
    });

    it("a tap made before the read lands is not undone by it", async () => {
      let resolveLoad: (folded: boolean) => void = () => {};
      mockFold.load.mockReturnValue(
        new Promise((r) => {
          resolveLoad = r;
        }),
      );
      renderDashboard();
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse dashboard" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Expand dashboard" }));
      resolveLoad(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.getByText("Calories")).toBeTruthy();
    });

    it("Expand while typing saves the card as open", () => {
      mockFold.cached = true;
      renderComponent(
        <CoachDashboard
          context={context}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
          forceCollapsed
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Expand dashboard" }));
      expect(mockFold.save).toHaveBeenLastCalledWith(false);
    });

    it("the keyboard's fold is never saved as the user's choice", () => {
      renderComponent(
        <CoachDashboard
          context={context}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
          forceCollapsed
        />,
      );
      expect(mockFold.save).not.toHaveBeenCalled();
    });
  });

  it("the Notebook button sits in the top row and opens the notebook", () => {
    const onNotebookPress = renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Collapse dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Open notebook" }));
    expect(onNotebookPress).toHaveBeenCalledTimes(1);
  });

  // While typing, the keyboard and the open dashboard together leave the chat
  // input no room (Galaxy A37: 453 + ~358 of 832 dp), so it folds — measured
  // 2026-11-02, the input sat under the keyboard.
  describe("while the keyboard is up (forceCollapsed)", () => {
    function renderTyping(forceCollapsed: boolean) {
      return renderComponent(
        <CoachDashboard
          context={context}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
          forceCollapsed={forceCollapsed}
        />,
      );
    }

    it("folds to the top row", () => {
      renderTyping(true);
      expect(screen.queryByText("Calories")).toBeNull();
      expect(screen.queryByText("Pumpkin seeds add iron")).toBeNull();
      expect(screen.getByText("420 / 1,949 cal")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Expand dashboard" }),
      ).toBeTruthy();
    });

    it("reopens when the keyboard goes, if the user had it open", () => {
      const { rerender } = renderTyping(true);
      rerender(
        <CoachDashboard
          context={context}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
          forceCollapsed={false}
        />,
      );
      expect(screen.getByText("Calories")).toBeTruthy();
    });

    it("stays folded when the keyboard goes, if the user had folded it", () => {
      const { rerender } = renderTyping(false);
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse dashboard" }),
      );
      rerender(
        <CoachDashboard
          context={context}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
          forceCollapsed={true}
        />,
      );
      rerender(
        <CoachDashboard
          context={context}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
          forceCollapsed={false}
        />,
      );
      expect(screen.queryByText("Calories")).toBeNull();
    });

    // "Expand" must never be a dead button: it closes the keyboard, which
    // lifts the fold and shows the dashboard.
    it("tapping Expand closes the keyboard", () => {
      renderTyping(true);
      fireEvent.click(screen.getByRole("button", { name: "Expand dashboard" }));
      expect(mockKeyboardDismiss).toHaveBeenCalledTimes(1);
    });

    it("a normal fold toggle does not touch the keyboard", () => {
      renderTyping(false);
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse dashboard" }),
      );
      expect(mockKeyboardDismiss).not.toHaveBeenCalled();
    });
  });

  // The notebook stores a fact again each time a later turn re-learns it, so
  // the two newest insights were the same sentence on the demo account
  // (rows 353932/353926, 2026-11-08) and the card showed it twice.
  it("shows a repeated tip once and fills the second slot with the next one", () => {
    renderComponent(
      <CoachDashboard
        context={{
          ...context,
          notebook: [
            { id: 1, type: "insight", content: "Oats keep you full." },
            { id: 2, type: "insight", content: "  oats keep you  FULL " },
            { id: 3, type: "insight", content: "Pumpkin seeds add iron" },
          ] as NotebookEntry[],
        }}
        onSuggestionPress={vi.fn()}
        onNotebookPress={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/oats keep you full/i)).toHaveLength(1);
    expect(screen.getByText("Pumpkin seeds add iron")).toBeTruthy();
  });

  // The next-newest row (353921) was the same sentence with a clause added.
  it("treats a tip that only extends another as the same tip", () => {
    renderComponent(
      <CoachDashboard
        context={{
          ...context,
          notebook: [
            {
              id: 1,
              type: "insight",
              content:
                "A balanced breakfast should include protein, fiber-rich carbohydrates, and healthy fats.",
            },
            {
              id: 2,
              type: "insight",
              content:
                "A balanced breakfast should include protein, fiber-rich carbohydrates, and healthy fats to support fullness and steady energy.",
            },
            { id: 3, type: "insight", content: "Pumpkin seeds add iron" },
          ] as NotebookEntry[],
        }}
        onSuggestionPress={vi.fn()}
        onNotebookPress={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/a balanced breakfast/i)).toHaveLength(1);
    expect(screen.getByText("Pumpkin seeds add iron")).toBeTruthy();
  });

  describe("stat tiles", () => {
    function renderIntake(
      totalCalories: number,
      totalProtein: number,
      calorieGoal = 1949,
    ) {
      renderComponent(
        <CoachDashboard
          context={{
            ...context,
            goals: { ...context.goals!, calories: calorieGoal },
            todayIntake: {
              ...context.todayIntake!,
              totalCalories,
              totalProtein,
            },
          }}
          onSuggestionPress={vi.fn()}
          onNotebookPress={vi.fn()}
        />,
      );
    }

    // The tile printed the raw subtraction ("1949", "412.6") while the top
    // row printed "1,949".
    it("rounds and groups the numbers like the top row", () => {
      renderIntake(420, 12.345, 2500);
      expect(screen.getByText("2,080")).toBeTruthy();
      expect(screen.getByText("12g")).toBeTruthy();
      expect(screen.getByText("Remaining")).toBeTruthy();
    });

    it("rounds a fractional remainder", () => {
      renderIntake(1536.4, 40);
      expect(screen.getByText("413")).toBeTruthy();
    });

    // 2000 - 2000.4 rounds to -0, which is not < 0 and prints as "-0".
    it("a fraction of a calorie over the goal reads 0 remaining", () => {
      renderIntake(2000.4, 90, 2000);
      expect(screen.getByText("0")).toBeTruthy();
      expect(screen.queryByText("-0")).toBeNull();
      expect(screen.getByText("Remaining")).toBeTruthy();
    });

    it("past the goal it says how far over, not a negative remainder", () => {
      renderIntake(2100.2, 90);
      expect(screen.getByText("151")).toBeTruthy();
      expect(screen.getByText("Over")).toBeTruthy();
      expect(screen.queryByText("Remaining")).toBeNull();
    });
  });

  it("with no goals set, the top row shows calories alone", () => {
    renderComponent(
      <CoachDashboard
        context={{ ...context, goals: null }}
        onSuggestionPress={vi.fn()}
        onNotebookPress={vi.fn()}
      />,
    );
    expect(screen.getByText("420 cal")).toBeTruthy();
  });
});
