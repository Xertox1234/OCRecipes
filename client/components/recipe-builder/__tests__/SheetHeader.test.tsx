// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SheetHeader } from "../SheetHeader";

describe("SheetHeader", () => {
  it("renders the title text", () => {
    renderComponent(<SheetHeader title="Ingredients" onDone={() => {}} />);
    expect(screen.getByText("Ingredients")).toBeDefined();
  });

  it("renders the Done button", () => {
    renderComponent(<SheetHeader title="Nutrition" onDone={() => {}} />);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("calls onDone when Done is pressed", () => {
    const onDone = vi.fn();
    renderComponent(<SheetHeader title="Tags" onDone={onDone} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
