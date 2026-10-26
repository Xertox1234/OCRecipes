// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { reactProps } from "../../../../test/utils/react-props";
import { renderComponent } from "../../../../test/utils/render-component";
import TitleStep from "../TitleStep";
import {
  isValidTitle,
  truncateTitle,
  truncateDescription,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from "../title-step-utils";

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("isValidTitle", () => {
  it("returns false for empty string", () => {
    expect(isValidTitle("")).toBe(false);
  });

  it("returns false for whitespace-only input", () => {
    expect(isValidTitle("    ")).toBe(false);
  });

  it("returns false when length is below the 3-char floor", () => {
    expect(isValidTitle("Hi")).toBe(false);
  });

  it("returns true at exactly the min length", () => {
    expect(isValidTitle("abc")).toBe(true);
    expect("abc".length).toBe(TITLE_MIN_LENGTH);
  });

  it("trims before measuring length", () => {
    // 3 visible chars surrounded by whitespace is valid.
    expect(isValidTitle("  abc  ")).toBe(true);
    // 2 visible chars surrounded by whitespace is still invalid.
    expect(isValidTitle("  ab  ")).toBe(false);
  });
});

describe("truncateTitle", () => {
  it("returns the input unchanged when under the limit", () => {
    expect(truncateTitle("Pancakes")).toBe("Pancakes");
  });

  it("returns the input unchanged when exactly at the limit", () => {
    const atLimit = "x".repeat(TITLE_MAX_LENGTH);
    expect(truncateTitle(atLimit)).toBe(atLimit);
  });

  it("truncates when input exceeds the limit", () => {
    const overLimit = "x".repeat(TITLE_MAX_LENGTH + 50);
    expect(truncateTitle(overLimit)).toHaveLength(TITLE_MAX_LENGTH);
  });
});

describe("truncateDescription", () => {
  it("returns the input unchanged when under the limit", () => {
    expect(truncateDescription("short")).toBe("short");
  });

  it("truncates when input exceeds the limit", () => {
    const overLimit = "y".repeat(DESCRIPTION_MAX_LENGTH + 10);
    expect(truncateDescription(overLimit)).toHaveLength(DESCRIPTION_MAX_LENGTH);
  });
});

// ── Rendered TitleStep ───────────────────────────────────────────────────────

describe("TitleStep — render", () => {
  it("renders title and description inputs with accessibility labels", () => {
    renderComponent(
      <TitleStep
        title=""
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Recipe title")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
  });

  it("sets the native maxLength attribute matching the utility constants", () => {
    renderComponent(
      <TitleStep
        title=""
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    const titleInput = screen.getByLabelText(
      "Recipe title",
    ) as HTMLInputElement;
    const descInput = screen.getByLabelText("Description") as HTMLInputElement;
    expect(titleInput.getAttribute("maxLength")).toBe(String(TITLE_MAX_LENGTH));
    expect(descInput.getAttribute("maxLength")).toBe(
      String(DESCRIPTION_MAX_LENGTH),
    );
  });

  it("calls setTitle as the user types", () => {
    const setTitle = vi.fn();
    renderComponent(
      <TitleStep
        title=""
        setTitle={setTitle}
        description=""
        setDescription={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Recipe title"), {
      target: { value: "Pancakes" },
    });
    expect(setTitle).toHaveBeenCalledWith("Pancakes");
  });

  it("calls setDescription as the user types in the description field", () => {
    const setDescription = vi.fn();
    renderComponent(
      <TitleStep
        title=""
        setTitle={vi.fn()}
        description=""
        setDescription={setDescription}
      />,
    );
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Fluffy and warm" },
    });
    expect(setDescription).toHaveBeenCalledWith("Fluffy and warm");
  });

  it("renders the current title and description values", () => {
    renderComponent(
      <TitleStep
        title="Pancakes"
        setTitle={vi.fn()}
        description="Fluffy"
        setDescription={vi.fn()}
      />,
    );
    const titleInput = screen.getByLabelText(
      "Recipe title",
    ) as HTMLInputElement;
    const descInput = screen.getByLabelText("Description") as HTMLInputElement;
    expect(titleInput.value).toBe("Pancakes");
    expect(descInput.value).toBe("Fluffy");
  });

  it("floats each field's name on the field instead of a caps label above it", () => {
    renderComponent(
      <TitleStep
        title=""
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    const labels = screen
      .getAllByTestId("focus-field-label")
      .map((l) => l.textContent);
    expect(labels).toEqual(["Recipe title", "Description"]);
    expect(screen.queryByText("RECIPE NAME")).toBeNull();
    expect(screen.queryByText("DESCRIPTION (optional)")).toBeNull();
  });

  it("shows the example placeholder once the title field has focus", () => {
    renderComponent(
      <TitleStep
        title=""
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    const titleInput = screen.getByLabelText("Recipe title");
    fireEvent.focus(titleInput);
    expect(titleInput.getAttribute("placeholder")).toBe(
      "e.g. Creamy Tomato Pasta",
    );
  });

  it("holds the description's example back until its label floats", () => {
    renderComponent(
      <TitleStep
        title=""
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    const descInput = screen.getByLabelText("Description");
    expect(descInput.getAttribute("placeholder")).toBeNull();
    fireEvent.focus(descInput);
    expect(descInput.getAttribute("placeholder")).toBe(
      "Optional · e.g. a weeknight family favourite",
    );
  });
});

describe("TitleStep counters", () => {
  it("shows the title counter only while the title is focused", () => {
    renderComponent(
      <TitleStep
        title="Soup"
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    const counter = `4/${TITLE_MAX_LENGTH}`;
    const input = screen.getByLabelText("Recipe title");
    fireEvent.blur(input);
    expect(screen.queryByText(counter)).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByText(counter)).toBeTruthy();
    fireEvent.blur(input);
    expect(screen.queryByText(counter)).toBeNull();
  });
});

describe("TitleStep — Return key", () => {
  it("Return on the title moves to the description", () => {
    renderComponent(
      <TitleStep
        title="Pasta"
        setTitle={vi.fn()}
        description=""
        setDescription={vi.fn()}
      />,
    );
    const title = screen.getByLabelText("Recipe title");
    const props = reactProps(title);
    expect(props.returnKeyType).toBe("next");
    act(() => {
      (props.onSubmitEditing as () => void)();
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });
});
