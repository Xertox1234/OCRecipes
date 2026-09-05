// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { useConfirmationModal } from "../ConfirmationModal";
import type { ConfirmOptions } from "../ConfirmationModal";

// useSheetBackHandler calls useIsFocused (@react-navigation/native), which
// needs a NavigationContainer ancestor the plain renderComponent() wrapper
// doesn't provide — mock it directly rather than pull in a real container.
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
}));

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

  describe("screen-reader announcement on open", () => {
    // The sheet replaced native Alert.alert call sites (issue #908), and
    // Alert.alert got its title/message read aloud by the OS for free. The
    // sheet must announce its own purpose — same delayed pattern and
    // rationale as UpgradeModal (the ~500ms delay outlasts the present
    // animation so iOS VoiceOver doesn't swallow it).
    afterEach(() => {
      vi.useRealTimers();
    });

    it("announces title and message after the open delay", () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(spy).toHaveBeenCalledWith("Delete Entry. Remove this item?");
    });

    it("does not announce when the sheet is dismissed before the delay", () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      fireEvent.click(screen.getByText("Cancel"));
      vi.advanceTimersByTime(1000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("hides the decorative destructive warning icon from the a11y tree", () => {
    // The alert-triangle glyph repeats nothing beyond the title/message that
    // follow it; unmarked it becomes its own screen-reader focus stop. The
    // jsdom RN mock maps the accessibilityElementsHidden +
    // importantForAccessibility="no-hide-descendants" pair to aria-hidden,
    // which is the assertable signal here.
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    const icon = screen.getByTestId("confirmation-modal-destructive-icon");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
});
