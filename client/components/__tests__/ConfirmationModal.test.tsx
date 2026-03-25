// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { useConfirmationModal } from "../ConfirmationModal";
import type { ConfirmOptions } from "../ConfirmationModal";

// Test wrapper that exposes the hook API via a trigger button
function TestHarness({ options }: { options: ConfirmOptions }) {
  const { confirm, ConfirmationModal } = useConfirmationModal();
  return (
    <>
      <button onClick={() => confirm(options)} data-testid="trigger">
        Open
      </button>
      <ConfirmationModal />
    </>
  );
}

function triggerModal() {
  fireEvent.click(screen.getByTestId("trigger"));
}

describe("ConfirmationModal", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  const defaultOptions: ConfirmOptions = {
    title: "Delete Entry",
    message: "Remove this item?",
    onConfirm,
    onCancel,
    destructive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders title and message after confirm() is called", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    expect(screen.getByText("Delete Entry")).toBeDefined();
    expect(screen.getByText("Remove this item?")).toBeDefined();
  });

  it("renders default destructive labels (Delete / Cancel)", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    expect(screen.getByText("Delete")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("renders custom labels when provided", () => {
    const options: ConfirmOptions = {
      ...defaultOptions,
      confirmLabel: "Remove",
      cancelLabel: "Keep",
    };
    renderComponent(<TestHarness options={options} />);
    triggerModal();
    expect(screen.getByText("Remove")).toBeDefined();
    expect(screen.getByText("Keep")).toBeDefined();
  });

  it("renders non-destructive default label (Confirm)", () => {
    const options: ConfirmOptions = {
      ...defaultOptions,
      destructive: false,
      confirmLabel: undefined,
    };
    renderComponent(<TestHarness options={options} />);
    triggerModal();
    expect(screen.getByText("Confirm")).toBeDefined();
  });

  it("calls onConfirm when confirm button is pressed", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("has accessible button roles on confirm and cancel", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    const buttons = screen.getAllByRole("button");
    // trigger button + cancel + confirm = at least 3
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the bottom sheet modal container", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    const modal = screen.getByTestId("bottom-sheet-modal");
    expect(modal).toBeDefined();
  });

  it("renders empty content before confirm() is called", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    // Before triggering, options ref is null → empty strings
    expect(screen.queryByText("Delete Entry")).toBeNull();
  });
});
