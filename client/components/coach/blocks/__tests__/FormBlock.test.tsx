// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import FormBlock from "../FormBlock";
import type { FormBlock as FormBlockType } from "@shared/schemas/coach-form";

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));

const block: FormBlockType = {
  type: "form",
  title: "A few details",
  fields: [
    { kind: "choice", label: "Which meal?", options: ["Lunch", "Dinner"] },
    { kind: "multi_choice", label: "Avoid", options: ["Dairy", "Gluten"] },
    { kind: "number", label: "Servings", min: 1, max: 8, step: 1, value: 2 },
  ],
  submitLabel: "Send",
};

describe("FormBlock", () => {
  it("shows the title, every field and the submit button", () => {
    renderComponent(<FormBlock block={block} />);
    expect(screen.getByText("A few details")).toBeTruthy();
    expect(screen.getByText("Which meal?")).toBeTruthy();
    expect(screen.getByLabelText("Lunch")).toBeTruthy();
    expect(screen.getByLabelText("Dairy")).toBeTruthy();
    expect(screen.getByLabelText("Servings")).toBeTruthy();
    expect(screen.getByLabelText("Send")).toBeTruthy();
  });

  it("sends the answers as one message, with the block key", () => {
    const onSubmit = vi.fn();
    renderComponent(
      <FormBlock block={block} onSubmit={onSubmit} blockKey="7-0" />,
    );
    fireEvent.click(screen.getByLabelText("Dinner"));
    fireEvent.click(screen.getByLabelText("Gluten"));
    fireEvent.click(screen.getByLabelText("More Servings"));
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledWith(
      "Which meal? Dinner\nAvoid: Gluten\nServings: 3",
      "7-0",
    );
  });

  it("clears a choice when its selected option is tapped again", () => {
    const onSubmit = vi.fn();
    renderComponent(<FormBlock block={block} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText("Dinner"));
    fireEvent.click(screen.getByLabelText("Dinner"));
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledWith("Servings: 2", undefined);
  });

  it("uses a default button label, and keeps it disabled with nothing answered", () => {
    const onSubmit = vi.fn();
    renderComponent(
      <FormBlock
        block={{ type: "form", fields: [block.fields[0]] }}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByLabelText("Send answers"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send while a reply is on its way", () => {
    const onSubmit = vi.fn();
    renderComponent(<FormBlock block={block} onSubmit={onSubmit} busy />);
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows only a closed summary, with no controls, once it is not live", () => {
    renderComponent(<FormBlock block={block} live={false} />);
    expect(screen.queryByLabelText("Send")).toBeNull();
    expect(screen.queryByLabelText("Lunch")).toBeNull();
    expect(
      screen.getByLabelText("Closed form: Which meal?, Avoid, Servings"),
    ).toBeTruthy();
  });
});
