// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { InlineError } from "../InlineError";

describe("InlineError", () => {
  it("renders null for null message", () => {
    const { container } = renderComponent(<InlineError message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null for undefined message", () => {
    const { container } = renderComponent(<InlineError message={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null for empty string message", () => {
    const { container } = renderComponent(<InlineError message="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders message text when provided", () => {
    renderComponent(<InlineError message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("has accessibilityRole alert", () => {
    renderComponent(<InlineError message="Error occurred" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});
