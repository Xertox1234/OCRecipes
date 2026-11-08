// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { JumpToLatestButton } from "../JumpToLatestButton";

describe("JumpToLatestButton", () => {
  it("renders a labelled button when visible, and jumps on press", () => {
    const onPress = vi.fn();
    renderComponent(<JumpToLatestButton visible onPress={onPress} />);
    const button = screen.getByRole("button", {
      name: "Jump to latest message",
    });
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while hidden", () => {
    renderComponent(<JumpToLatestButton visible={false} onPress={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Jump to latest message" }),
    ).toBeNull();
  });
});
