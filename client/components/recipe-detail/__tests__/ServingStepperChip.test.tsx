// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import { ServingStepperChip } from "../ServingStepperChip";

const { mockNotification } = vi.hoisted(() => ({
  mockNotification: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: mockNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

function renderChip() {
  const onSetServings = vi.fn();
  renderComponent(
    <ServingStepperChip
      servingCount={4}
      isAdjusted={false}
      onIncrement={vi.fn()}
      onDecrement={vi.fn()}
      onSetServings={onSetServings}
    />,
  );
  return { onSetServings };
}

function typeAndSubmit(text: string) {
  fireEvent.click(screen.getByLabelText("Edit serving count"));
  const input = screen.getByLabelText("Number of servings");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  // Submitting blurs the field on device; blur runs the same check.
  fireEvent.blur(input);
}

describe("ServingStepperChip — typed servings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says why it refuses 0, keeps the old value, and buzzes once", () => {
    const { onSetServings } = renderChip();
    typeAndSubmit("0");

    expect(screen.getByText("Servings must be 1–99")).toBeTruthy();
    expect(onSetServings).not.toHaveBeenCalled();
    expect(screen.getByLabelText("4 servings")).toBeTruthy();
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  it("refuses a fractional count with the message, not a silent revert", () => {
    const { onSetServings } = renderChip();
    typeAndSubmit("1.5");

    expect(screen.getByText("Servings must be 1–99")).toBeTruthy();
    expect(onSetServings).not.toHaveBeenCalled();
  });

  it("sets a valid count once and shows no message", () => {
    const { onSetServings } = renderChip();
    typeAndSubmit("6");

    expect(onSetServings).toHaveBeenCalledExactlyOnceWith(6);
    expect(screen.queryByText("Servings must be 1–99")).toBeNull();
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("clears the message after the next valid count", () => {
    renderChip();
    typeAndSubmit("0");
    expect(screen.getByText("Servings must be 1–99")).toBeTruthy();

    typeAndSubmit("3");
    expect(screen.queryByText("Servings must be 1–99")).toBeNull();
  });

  // On device, Return fires onSubmitEditing and then the blur it causes,
  // both before React re-renders, so both run the same render's handler. The
  // shared RN mock renders a plain <input> that never fires onSubmitEditing,
  // and a later fireEvent.blur would hit an already-unmounted input — so call
  // the two props React attached to the element inside one act().
  it("checks once when submit is followed by its blur", () => {
    const { onSetServings } = renderChip();
    fireEvent.click(screen.getByLabelText("Edit serving count"));
    const input = screen.getByLabelText("Number of servings");
    fireEvent.change(input, { target: { value: "0" } });

    const propsKey = Object.keys(input).find((k) =>
      k.startsWith("__reactProps$"),
    );
    const props = (input as unknown as Record<string, Record<string, unknown>>)[
      propsKey!
    ];
    expect(typeof props.onSubmitEditing).toBe("function");
    expect(typeof props.onBlur).toBe("function");
    act(() => {
      (props.onSubmitEditing as () => void)();
      (props.onBlur as (e: unknown) => void)({ nativeEvent: {} });
    });

    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(onSetServings).not.toHaveBeenCalled();
    expect(screen.getAllByText("Servings must be 1–99")).toHaveLength(1);
  });

  it("treats an emptied field as a cancel, not a refusal", () => {
    const { onSetServings } = renderChip();
    typeAndSubmit("");

    expect(onSetServings).not.toHaveBeenCalled();
    expect(screen.queryByText("Servings must be 1–99")).toBeNull();
    expect(mockNotification).not.toHaveBeenCalled();
  });
});
