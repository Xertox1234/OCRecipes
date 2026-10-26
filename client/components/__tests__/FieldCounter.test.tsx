// @vitest-environment jsdom
import React from "react";
import { screen, act } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";

import { renderComponent } from "../../../test/utils/render-component";
import { FieldCounter, counterTone } from "../FieldCounter";

describe("counterTone", () => {
  it("is normal below the last tenth", () => {
    expect(counterTone(449, 500)).toBe("normal");
  });
  it("is near inside the last tenth", () => {
    expect(counterTone(450, 500)).toBe("near");
    expect(counterTone(499, 500)).toBe("near");
  });
  it("is at the limit", () => {
    expect(counterTone(500, 500)).toBe("at");
  });
  it("rounds the near band up for small limits", () => {
    expect(counterTone(89, 100)).toBe("normal");
    expect(counterTone(90, 100)).toBe("near");
  });
});

describe("FieldCounter", () => {
  let announce: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  });
  afterEach(() => {
    vi.useRealTimers();
    announce.mockRestore();
  });

  it("renders nothing visible when not visible", () => {
    renderComponent(<FieldCounter length={10} max={500} visible={false} />);
    expect(screen.queryByText("10/500")).toBeNull();
  });

  it("shows length/max when visible", () => {
    renderComponent(<FieldCounter length={142} max={500} visible />);
    expect(screen.getByText("142/500")).toBeTruthy();
  });

  it("hides the text from screen readers", () => {
    renderComponent(<FieldCounter length={142} max={500} visible />);
    const el = screen.getByText("142/500");
    expect(el.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("announces once on entering near and once on entering at", () => {
    const { rerender } = renderComponent(
      <FieldCounter length={449} max={500} visible />,
    );
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();

    rerender(<FieldCounter length={450} max={500} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith("50 characters left");

    rerender(<FieldCounter length={460} max={500} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);

    rerender(<FieldCounter length={500} max={500} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith("Character limit reached");
  });

  it("does not announce while hidden", () => {
    const { rerender } = renderComponent(
      <FieldCounter length={10} max={500} visible={false} />,
    );
    rerender(<FieldCounter length={480} max={500} visible={false} />);
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();
  });
});
