// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachCameraButton from "../CoachCameraButton";

describe("CoachCameraButton", () => {
  it("calls onPress", () => {
    const onPress = vi.fn();
    renderComponent(<CoachCameraButton onPress={onPress} />);
    fireEvent.click(screen.getByLabelText("Send a photo of your meal"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("does nothing while disabled", () => {
    const onPress = vi.fn();
    renderComponent(<CoachCameraButton onPress={onPress} disabled />);
    fireEvent.click(screen.getByLabelText("Send a photo of your meal"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
