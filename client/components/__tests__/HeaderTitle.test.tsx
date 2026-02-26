// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { HeaderTitle } from "../HeaderTitle";

// Mock image require — vitest can't resolve PNG imports
vi.mock("../../assets/images/icon.png", () => ({ default: "icon.png" }));

describe("HeaderTitle", () => {
  it("renders the title text", () => {
    renderComponent(<HeaderTitle title="Home" />);
    expect(screen.getByText("Home")).toBeDefined();
  });

  it("renders an icon by default (showIcon=true)", () => {
    renderComponent(<HeaderTitle title="Home" />);
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("hides the icon when showIcon is false", () => {
    renderComponent(<HeaderTitle title="History" showIcon={false} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
