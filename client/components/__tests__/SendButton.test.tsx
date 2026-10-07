// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SendButton } from "../SendButton";

vi.mock("@/components/TypingDots", () => ({
  TypingDots: () => <div data-testid="typing-dots" />,
}));

describe("SendButton", () => {
  it("sends when it can", () => {
    const onPress = vi.fn();
    renderComponent(<SendButton onPress={onPress} canSend />);

    fireEvent.click(screen.getByLabelText("Send message"));

    expect(onPress).toHaveBeenCalledOnce();
  });

  it("is disabled and inert when it can't send", () => {
    const onPress = vi.fn();
    renderComponent(<SendButton onPress={onPress} canSend={false} />);

    const button = screen.getByLabelText("Send message");
    fireEvent.click(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows typing dots instead of the icon while busy, and won't send", () => {
    const onPress = vi.fn();
    renderComponent(<SendButton onPress={onPress} canSend busy />);

    expect(screen.getByTestId("typing-dots")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows no typing dots when idle", () => {
    renderComponent(<SendButton onPress={vi.fn()} canSend />);
    expect(screen.queryByTestId("typing-dots")).toBeNull();
  });
});
