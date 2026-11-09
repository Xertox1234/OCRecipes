// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import OpeningBrief from "../OpeningBrief";
import { renderOpeningBrief, type BriefInput } from "@shared/lib/opening-brief";

const mockHasUsed = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/feature-tips-storage", () => ({
  hasUsedFeature: () => mockHasUsed.value,
}));

const input: BriefInput = {
  localHour: 14,
  name: "Will",
  consumedCalories: 820,
  calorieGoal: 1949,
  consumedProtein: 42,
  proteinGoal: 120,
  tonightPlan: "Lentil stew",
  expiringPantry: [],
  suggestions: ["High-protein snack?", "Log lunch", "Swap dinner", "Extra"],
  reminder: null,
};

function setup(over: Partial<BriefInput> = {}) {
  const props = {
    brief: renderOpeningBrief({ ...input, ...over }, "full"),
    onSend: vi.fn(),
    onQuickLog: vi.fn(),
    onShown: vi.fn(),
    onDismiss: vi.fn(),
    onDrop: vi.fn(),
  };
  const utils = renderComponent(<OpeningBrief {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  mockHasUsed.value = true;
});

it("shows the greeting, recap, three stat tiles and the pointer", () => {
  setup();
  expect(screen.getByText("Good afternoon, Will.")).toBeTruthy();
  expect(
    screen.getByText(
      "You're at 820 of 1,949 calories. Protein is behind at 42 of 120 g.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("1,129")).toBeTruthy();
  expect(screen.getByText("78 g")).toBeTruthy();
  expect(screen.getByText("Lentil stew")).toBeTruthy();
  expect(screen.getByText("Tonight's plan is Lentil stew.")).toBeTruthy();
});

it("reads as one coach message to a screen reader", () => {
  const { props } = setup();
  expect(
    screen.getByLabelText(
      `NutriCoach: ${props.brief.text.replace(/\n+/g, " ")}`,
    ),
  ).toBeTruthy();
});

it("sends a chip when tapped", () => {
  const { props } = setup();
  fireEvent.click(screen.getByLabelText("High-protein snack?"));
  expect(props.onSend).toHaveBeenCalledWith("High-protein snack?");
});

it("shows at most three chips, keeping room for a feature not yet used", () => {
  setup();
  expect(screen.queryByLabelText("Extra")).toBeNull();
  expect(screen.getByLabelText("Swap dinner")).toBeTruthy();

  mockHasUsed.value = false;
  setup();
  expect(screen.getAllByLabelText("Help me import a recipe")).toHaveLength(1);
  expect(screen.getAllByLabelText("Swap dinner")).toHaveLength(1);
});

it("leads with the reminder and answers it with a send", () => {
  const { props } = setup({
    reminder: {
      type: "commitment",
      notebookEntryId: 3,
      label: "overnight oats",
    },
  });
  const lead = "You were going to try overnight oats. How's that going?";
  expect(screen.getByText(lead)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(`Going well, ${lead}`));
  expect(props.onSend).toHaveBeenCalledWith("It's going well");
});

it("opens Quick Log from a missed-meal reminder", () => {
  const { props } = setup({
    consumedCalories: 0,
    consumedProtein: 0,
    reminder: { type: "meal-log" },
  });
  fireEvent.click(screen.getByLabelText("Log lunch, Want to log lunch?"));
  expect(props.onQuickLog).toHaveBeenCalledTimes(1);
  expect(props.onSend).not.toHaveBeenCalled();
});

it("reports that it was shown, once", () => {
  const { props, rerender } = setup();
  rerender(<OpeningBrief {...props} />);
  expect(props.onShown).toHaveBeenCalledTimes(1);
});

it("Not today clears just that reminder, sends nothing and hides it", () => {
  const { props } = setup({
    consumedCalories: 0,
    consumedProtein: 0,
    reminder: { type: "meal-log" },
  });
  fireEvent.click(screen.getByLabelText("Not today, Want to log lunch?"));
  expect(props.onDismiss).toHaveBeenCalledWith("meal-log");
  expect(props.onSend).not.toHaveBeenCalled();
  expect(screen.queryByText("Want to log lunch?")).toBeNull();
});

it("Drop it hands over the commitment and its message", () => {
  const { props } = setup({
    reminder: {
      type: "commitment",
      notebookEntryId: 3,
      label: "overnight oats",
    },
  });
  fireEvent.click(
    screen.getByLabelText(
      "Drop it, You were going to try overnight oats. How's that going?",
    ),
  );
  expect(props.onDrop).toHaveBeenCalledWith(3, "I want to drop it");
});
