// @vitest-environment jsdom
import React from "react";
import { act, screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import * as Haptics from "expo-haptics";
import { RecipeAdjust } from "../RecipeAdjust";
import {
  finderActionSchema,
  type RecipeAdjustBlock,
} from "@shared/schemas/recipe-finder";

const FLOW = "00000000-0000-4000-8000-000000000000";

const block: RecipeAdjustBlock = {
  type: "recipe_adjust",
  prefill: { servings: 8, spice: "mild", time: "moderate" },
  avoiding: ["peanuts", "shellfish"],
  noted: { dislikes: ["olives"] },
  followUps: [
    { question: "Beef, pork, or a mix?", options: ["Beef", "Mix", "Pork"] },
    { question: "Sauce?", options: ["Marinara", "Arrabbiata"] },
  ],
  flow: {
    flowId: FLOW,
    stage: "adjust",
    request: "spaghetti and meatballs for 8",
    query: { q: "spaghetti and meatballs" },
    round: 0,
    shownIds: [],
    dish: "Spaghetti & meatballs",
  },
};

function setup(over: Partial<React.ComponentProps<typeof RecipeAdjust>> = {}) {
  const onAction = vi.fn();
  renderComponent(
    <RecipeAdjust block={block} isActive onAction={onAction} {...over} />,
  );
  return { onAction };
}

describe("RecipeAdjust — layout", () => {
  it("titles the card with the dish", () => {
    setup();
    expect(screen.getByRole("header").textContent).toBe(
      "Spaghetti & meatballs",
    );
  });

  it("shows the locked allergies with the profile hint as one label", () => {
    setup();
    expect(
      screen.getByLabelText(
        "Avoiding peanuts, shellfish. Change allergies in your profile.",
      ),
    ).toBeDefined();
  });

  it("shows what else was noted", () => {
    setup();
    expect(screen.getByText("dislikes olives")).toBeDefined();
  });

  it("hides Avoiding and Also noted when the profile has nothing", () => {
    setup({
      block: { ...block, avoiding: [], noted: { dislikes: [] } },
    });
    expect(screen.queryByText("Avoiding")).toBeNull();
    expect(screen.queryByText("Also noted")).toBeNull();
  });
});

describe("RecipeAdjust — servings stepper", () => {
  it("is one adjustable control named Servings", () => {
    setup();
    const stepper = screen.getByRole("adjustable", { name: "Servings" });
    expect(stepper).toBeDefined();
  });

  it("steps up and down, and stops at 1 and 20", () => {
    setup({
      block: { ...block, prefill: { ...block.prefill, servings: 2 } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fewer servings" }));
    expect(screen.getByTestId("adjust-servings").textContent).toBe("1");
    expect(
      screen
        .getByRole("button", { name: "Fewer servings" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    expect(screen.getByTestId("adjust-servings").textContent).toBe("3");
  });

  it("ticks once per step", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe("RecipeAdjust — chips", () => {
  it("spice and time are single-select chips that expose selection", () => {
    setup();
    expect(
      screen.getByRole("radio", { name: "Mild" }).getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Hot" }));
    expect(
      screen.getByRole("radio", { name: "Hot" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Mild" }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen
        .getByRole("radio", { name: "30-60 minutes" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("RecipeAdjust — actions", () => {
  it("Generate sends a schema-valid action with the settings and only the answered questions", () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Medium" }));
    fireEvent.click(screen.getByRole("radio", { name: "Under 30 minutes" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mix" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const [action, label] = onAction.mock.calls[0];
    expect(action).toEqual({
      type: "adjust_generate",
      flowId: FLOW,
      settings: { servings: 9, spice: "medium", time: "quick" },
      answers: [{ question: "Beef, pork, or a mix?", answer: "Mix" }],
    });
    expect(finderActionSchema.safeParse(action).success).toBe(true);
    expect(label).toBe("Generate: 9 servings · medium · under 30 minutes");
  });

  it("tapping a picked follow-up again clears it", () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Mix" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mix" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(onAction.mock.calls[0][0]).not.toHaveProperty("answers");
  });

  it("Cancel sends adjust_cancel", () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAction).toHaveBeenCalledWith(
      { type: "adjust_cancel", flowId: FLOW },
      "Cancel",
    );
  });

  it("an old card is inert", () => {
    const { onAction } = setup({ isActive: false });
    expect(screen.queryByRole("radio", { name: "Hot" })).toBeNull();
    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "More servings" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(generate);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAction).not.toHaveBeenCalled();
  });
});

/** React keeps every prop on the host node's fiber — including ones the
 *  DOM mock declines to wire (see LogActionBar.test.tsx for the precedent). */
function reactProp(node: Element, name: string): (event: unknown) => void {
  const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("React props key not found on node");
  const handler = (node as unknown as Record<string, Record<string, unknown>>)[
    key
  ][name];
  if (typeof handler !== "function") throw new Error(`${name} not a function`);
  return handler as (event: unknown) => void;
}

describe("RecipeAdjust — fix round 1", () => {
  it("More servings disables at 20", () => {
    setup({
      block: { ...block, prefill: { ...block.prefill, servings: 19 } },
    });
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    expect(screen.getByTestId("adjust-servings").textContent).toBe("20");
    expect(
      screen
        .getByRole("button", { name: "More servings" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("screen-reader increment/decrement step the stepper", () => {
    setup();
    const stepper = screen.getByRole("adjustable", { name: "Servings" });
    act(() =>
      reactProp(
        stepper,
        "onAccessibilityAction",
      )({
        nativeEvent: { actionName: "increment" },
      }),
    );
    expect(screen.getByTestId("adjust-servings").textContent).toBe("9");
    act(() =>
      reactProp(
        stepper,
        "onAccessibilityAction",
      )({
        nativeEvent: { actionName: "decrement" },
      }),
    );
    act(() =>
      reactProp(
        stepper,
        "onAccessibilityAction",
      )({
        nativeEvent: { actionName: "decrement" },
      }),
    );
    expect(screen.getByTestId("adjust-servings").textContent).toBe("7");
  });

  it("the stepper's value reads as servings, and its visible label is not read again", () => {
    setup();
    const stepper = screen.getByRole("adjustable", { name: "Servings" });
    const props = Object.keys(stepper).find((k) =>
      k.startsWith("__reactProps$"),
    ) as string;
    const value = (
      stepper as unknown as Record<string, Record<string, unknown>>
    )[props].accessibilityValue as { text: string };
    expect(value.text).toBe("8 servings");
    expect(
      screen.getByText("Servings").closest("[aria-hidden='true']"),
    ).not.toBeNull();
  });

  it("an old card still tells a screen reader which options were picked", () => {
    setup({ isActive: false });
    expect(screen.getByLabelText("Mild").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByLabelText("Hot").getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("keeps the choices across a remount of the same flow", () => {
    const store = new Map();
    const onAction = vi.fn();
    const first = renderComponent(
      <RecipeAdjust
        block={block}
        isActive
        onAction={onAction}
        choicesStore={store}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Hot" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pork" }));
    first.unmount();

    renderComponent(
      <RecipeAdjust
        block={block}
        isActive
        onAction={onAction}
        choicesStore={store}
      />,
    );
    expect(screen.getByTestId("adjust-servings").textContent).toBe("9");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(onAction.mock.calls[0][0]).toEqual({
      type: "adjust_generate",
      flowId: FLOW,
      settings: { servings: 9, spice: "hot", time: "moderate" },
      answers: [{ question: "Beef, pork, or a mix?", answer: "Pork" }],
    });
  });

  it("a different flow starts from its own prefill", () => {
    const store = new Map();
    const first = renderComponent(
      <RecipeAdjust
        block={block}
        isActive
        onAction={vi.fn()}
        choicesStore={store}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    first.unmount();
    renderComponent(
      <RecipeAdjust
        block={{
          ...block,
          flow: {
            ...block.flow,
            flowId: "11111111-1111-4111-8111-111111111111",
          },
        }}
        isActive
        onAction={vi.fn()}
        choicesStore={store}
      />,
    );
    expect(screen.getByTestId("adjust-servings").textContent).toBe("8");
  });
});
