// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SheetHeader, SheetOptionRow, SheetDragHandle } from "../SheetChrome";

describe("SheetChrome", () => {
  describe("SheetDragHandle", () => {
    it("renders without crashing and is not exposed as an accessible element", () => {
      const { container } = renderComponent(<SheetDragHandle />);
      expect(container.firstChild).not.toBeNull();
      expect(container.querySelector("[role]")).toBeNull();
    });
  });

  describe("SheetHeader", () => {
    it("renders the title and a Done control labelled Close with button role", () => {
      const onDone = vi.fn();
      renderComponent(<SheetHeader title="Add to Lunch" onDone={onDone} />);
      expect(screen.getByText("Add to Lunch")).toBeDefined();
      expect(screen.getByText("Done")).toBeDefined();
      const close = screen.getByLabelText("Close");
      expect(close.getAttribute("role")).toBe("button");
    });

    it("calls onDone when Done is pressed", () => {
      const onDone = vi.fn();
      renderComponent(<SheetHeader title="T" onDone={onDone} />);
      fireEvent.click(screen.getByLabelText("Close"));
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  describe("SheetOptionRow", () => {
    const baseProps = {
      icon: "book-open" as const,
      title: "Choose Recipe",
      description: "Search your recipes",
      accessibilityLabel: "Choose recipe",
    };

    it("renders title and description and exposes a labelled button", () => {
      renderComponent(<SheetOptionRow {...baseProps} onPress={vi.fn()} />);
      expect(screen.getByText("Choose Recipe")).toBeDefined();
      expect(screen.getByText("Search your recipes")).toBeDefined();
      const row = screen.getByLabelText("Choose recipe");
      expect(row.getAttribute("role")).toBe("button");
    });

    it("calls onPress when pressed", () => {
      const onPress = vi.fn();
      renderComponent(<SheetOptionRow {...baseProps} onPress={onPress} />);
      fireEvent.click(screen.getByLabelText("Choose recipe"));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it("accepts a trailingIcon override", () => {
      renderComponent(
        <SheetOptionRow
          {...baseProps}
          trailingIcon="lock"
          onPress={vi.fn()}
          accessibilityLabel="Choose recipe, premium feature"
        />,
      );
      expect(
        screen.getByLabelText("Choose recipe, premium feature"),
      ).toBeDefined();
    });
  });
});
