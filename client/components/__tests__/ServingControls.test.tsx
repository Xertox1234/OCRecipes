// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import * as Haptics from "expo-haptics";
import { ServingControls } from "../ServingControls";

const baseProps = {
  servingOptions: [
    { label: "1 cup", grams: 100 },
    { label: "1 bowl", grams: 200 },
  ],
  servingSizeGrams: 100,
  setServingSizeGrams: vi.fn(),
  servingQuantity: 1,
  setServingQuantity: vi.fn(),
  showCustomInput: false,
  setShowCustomInput: vi.fn(),
  customGramsInput: "",
  setCustomGramsInput: vi.fn(),
  recalculateNutrition: vi.fn(),
};

describe("ServingControls — serving size radio semantics", () => {
  it("wraps the serving chip row in a radiogroup", () => {
    renderComponent(<ServingControls {...baseProps} />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("exposes each serving option and the Custom chip as a radio with the correct selected state", () => {
    renderComponent(<ServingControls {...baseProps} />);

    // 2 serving options + the Custom chip = 3 mutually-exclusive radios.
    expect(screen.getAllByRole("radio")).toHaveLength(3);

    const activeChip = screen.getByLabelText("Set serving to 1 cup");
    expect(activeChip.getAttribute("role")).toBe("radio");
    expect(activeChip.getAttribute("aria-selected")).toBe("true");

    const inactiveChip = screen.getByLabelText("Set serving to 1 bowl");
    expect(inactiveChip.getAttribute("role")).toBe("radio");
    expect(inactiveChip.getAttribute("aria-selected")).toBe("false");

    const customChip = screen.getByLabelText("Enter custom serving size");
    expect(customChip.getAttribute("role")).toBe("radio");
    expect(customChip.getAttribute("aria-selected")).toBe("false");
  });

  it("marks the Custom chip selected instead of a serving option when custom input is active", () => {
    renderComponent(
      <ServingControls {...baseProps} showCustomInput customGramsInput="150" />,
    );

    expect(
      screen
        .getByLabelText("Enter custom serving size")
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByLabelText("Set serving to 1 cup")
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
});

describe("ServingControls — serving of unknown weight", () => {
  const unknownWeightProps = { ...baseProps, servingSizeGrams: null };

  it("marks no serving chip active when the serving weight is unknown", () => {
    renderComponent(<ServingControls {...unknownWeightProps} />);

    for (const label of ["Set serving to 1 cup", "Set serving to 1 bowl"]) {
      expect(screen.getByLabelText(label).getAttribute("aria-selected")).toBe(
        "false",
      );
    }
  });

  it("still rescales on the quantity stepper when the serving weight is unknown", () => {
    const recalculateNutrition = vi.fn();
    renderComponent(
      <ServingControls {...unknownWeightProps} {...{ recalculateNutrition }} />,
    );

    fireEvent.click(screen.getByLabelText("Increase serving quantity"));

    // Passing null through is the point: the hook scales the per-serving
    // baseline by quantity. A truthiness guard here would skip the call and
    // freeze the card's values while the counter climbs — and because
    // `servings` is never applied server-side, the user would log one serving
    // while the stepper reads two.
    expect(recalculateNutrition).toHaveBeenCalledWith(null, 1.5);
  });
});

describe("ServingControls — serving chip haptics", () => {
  it.each(["Set serving to 1 bowl", "Enter custom serving size"])(
    "%s gives one selection tick",
    (label) => {
      renderComponent(<ServingControls {...baseProps} />);
      fireEvent.click(screen.getByLabelText(label));
      expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    },
  );
});

describe("ServingControls — custom grams say why they refuse a value", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderCustom(customGramsInput: string) {
    const setServingSizeGrams = vi.fn();
    const recalculateNutrition = vi.fn();
    renderComponent(
      <ServingControls
        {...baseProps}
        showCustomInput
        customGramsInput={customGramsInput}
        setServingSizeGrams={setServingSizeGrams}
        recalculateNutrition={recalculateNutrition}
      />,
    );
    const input = screen.getByLabelText("Custom serving size in grams");
    fireEvent.blur(input);
    return { setServingSizeGrams, recalculateNutrition };
  }

  it.each(["0", "abc", "."])(
    "refuses %j with a message and an error buzz",
    (text) => {
      const { setServingSizeGrams } = renderCustom(text);
      expect(screen.getByText("Enter an amount above 0 g")).toBeTruthy();
      expect(setServingSizeGrams).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).toHaveBeenCalledExactlyOnceWith(
        Haptics.NotificationFeedbackType.Error,
      );
    },
  );

  it("accepts a comma decimal", () => {
    const { setServingSizeGrams, recalculateNutrition } = renderCustom("12,5");
    expect(setServingSizeGrams).toHaveBeenCalledWith(12.5);
    expect(recalculateNutrition).toHaveBeenCalledWith(12.5, 1);
    expect(screen.queryByText("Enter an amount above 0 g")).toBeNull();
  });

  it("leaves an empty field alone", () => {
    const { setServingSizeGrams } = renderCustom("");
    expect(setServingSizeGrams).not.toHaveBeenCalled();
    expect(screen.queryByText("Enter an amount above 0 g")).toBeNull();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});

// Follow-up from Task 11 review: a refused amount stayed in state while the
// custom field was hidden, and came back when Custom was tapped again.
describe("ServingControls — hiding the custom field drops its message", () => {
  beforeEach(() => vi.clearAllMocks());

  function Harness() {
    const [show, setShow] = React.useState(true);
    return (
      <ServingControls
        {...baseProps}
        showCustomInput={show}
        setShowCustomInput={setShow}
        customGramsInput="0"
      />
    );
  }

  it("a preset chip hides the field and its message; reopening starts clean", () => {
    renderComponent(<Harness />);
    fireEvent.blur(screen.getByLabelText("Custom serving size in grams"));
    expect(screen.getByText("Enter an amount above 0 g")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Set serving to 1 cup"));
    expect(screen.queryByLabelText("Custom serving size in grams")).toBeNull();
    expect(screen.queryByText("Enter an amount above 0 g")).toBeNull();

    fireEvent.click(screen.getByLabelText("Enter custom serving size"));
    expect(screen.getByLabelText("Custom serving size in grams")).toBeTruthy();
    expect(screen.queryByText("Enter an amount above 0 g")).toBeNull();
  });
});
