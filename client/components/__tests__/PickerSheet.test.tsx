// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ThemedText } from "@/components/ThemedText";
import { PickerCreateFooter, PickerSheet } from "../PickerSheet";

const footerProps = {
  showInput: false,
  onShowInput: vi.fn(),
  showNewButton: true,
  newButtonLabel: "New Thing",
  newButtonAccessibilityLabel: "Create new thing",
  inputLabel: "Thing name",
  placeholder: "Optional",
  name: "",
  onChangeName: vi.fn(),
  onCreate: vi.fn(),
  isCreating: false,
  createAccessibilityLabel: "Create thing and add",
  accentColor: "green",
  fillColor: "green",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PickerSheet", () => {
  it("renders the title, optional subtitle and its children", () => {
    renderComponent(
      <PickerSheet
        visible
        onClose={vi.fn()}
        title="Pick one"
        subtitle="Eggs"
        isLoading={false}
        accentColor="green"
      >
        <ThemedText>Row A</ThemedText>
      </PickerSheet>,
    );
    expect(screen.getByText("Pick one")).toBeDefined();
    expect(screen.getByText("Eggs")).toBeDefined();
    expect(screen.getByText("Row A")).toBeDefined();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    renderComponent(
      <PickerSheet
        visible
        onClose={onClose}
        title="Pick one"
        isLoading={false}
        accentColor="green"
      >
        <ThemedText>Row A</ThemedText>
      </PickerSheet>,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading row instead of the list while loading", () => {
    renderComponent(
      <PickerSheet
        visible
        onClose={vi.fn()}
        title="Pick one"
        isLoading
        accentColor="green"
        footer={<ThemedText>Footer</ThemedText>}
      >
        <ThemedText>Row A</ThemedText>
      </PickerSheet>,
    );
    expect(screen.queryByText("Row A")).toBeNull();
    // The footer stays: only the list area swaps for the spinner.
    expect(screen.getByText("Footer")).toBeDefined();
  });
});

describe("PickerCreateFooter", () => {
  it("shows the new button, which opens the input", () => {
    renderComponent(<PickerCreateFooter {...footerProps} />);
    fireEvent.click(screen.getByLabelText("Create new thing"));
    expect(footerProps.onShowInput).toHaveBeenCalledTimes(1);
    expect(screen.getByText("New Thing")).toBeDefined();
  });

  it("renders nothing when the new button is hidden and the input is closed", () => {
    renderComponent(
      <PickerCreateFooter {...footerProps} showNewButton={false} />,
    );
    expect(screen.queryByLabelText("Create new thing")).toBeNull();
  });

  it("with the input open, edits the name and creates from the button", () => {
    renderComponent(<PickerCreateFooter {...footerProps} showInput />);
    const input = screen.getByLabelText("Thing name");
    fireEvent.change(input, { target: { value: "Weekend" } });
    expect(footerProps.onChangeName).toHaveBeenCalledWith("Weekend");
    fireEvent.click(screen.getByLabelText("Create thing and add"));
    expect(footerProps.onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Create new thing")).toBeNull();
  });
});
