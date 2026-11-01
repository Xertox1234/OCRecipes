// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { Text } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { CenteredDialog } from "../CenteredDialog";

function renderDialog(visible = true) {
  const onRequestClose = vi.fn();
  renderComponent(
    <CenteredDialog
      visible={visible}
      onRequestClose={onRequestClose}
      backdropLabel="Close test dialog"
      dialogLabel="Test dialog"
      icon="mail"
      title="Test title"
      message="Test message"
    >
      <Text>dialog body</Text>
    </CenteredDialog>,
  );
  return { onRequestClose };
}

describe("CenteredDialog", () => {
  it("shows the title, message and children", () => {
    renderDialog();
    expect(screen.getByText("Test title")).toBeTruthy();
    expect(screen.getByText("Test message")).toBeTruthy();
    expect(screen.getByText("dialog body")).toBeTruthy();
  });

  it("tapping the backdrop requests close", () => {
    const { onRequestClose } = renderDialog();
    fireEvent.click(screen.getByTestId("centered-dialog-backdrop"));
    expect(onRequestClose).toHaveBeenCalled();
  });

  it("renders nothing while not visible", () => {
    renderDialog(false);
    expect(screen.queryByText("Test title")).toBeNull();
  });
});
