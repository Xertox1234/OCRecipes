// @vitest-environment jsdom
import React from "react";
import { screen, act } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";

import { renderComponent } from "../../../test/utils/render-component";
import { FieldRules } from "../FieldRules";
import { passwordRules, usernameRules } from "@/lib/field-rules";

describe("FieldRules", () => {
  let announce: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  });
  afterEach(() => {
    vi.useRealTimers();
    announce.mockRestore();
  });

  it("renders nothing when not visible", () => {
    renderComponent(
      <FieldRules rules={passwordRules("abc")} visible={false} />,
    );
    expect(screen.queryByText("At least 8 characters")).toBeNull();
  });

  it("shows each rule's label when visible", () => {
    renderComponent(<FieldRules rules={usernameRules("ab")} visible />);
    expect(screen.getByText("3–30 characters")).toBeTruthy();
    expect(screen.getByText("Letters, numbers or _")).toBeTruthy();
  });

  it("reads a met line as done and an unmet one as its label", () => {
    renderComponent(<FieldRules rules={usernameRules("ab")} visible />);
    expect(screen.getByLabelText("3–30 characters")).toBeTruthy();
    expect(screen.getByLabelText("Letters, numbers or _, done")).toBeTruthy();
  });

  it("hides the tick and circle icons from screen readers", () => {
    const { container } = renderComponent(
      <FieldRules rules={usernameRules("ab")} visible />,
    );
    const icons = container.querySelectorAll(
      '[data-testid^="field-rule-icon"]',
    );
    expect(icons).toHaveLength(2);
    icons.forEach((icon) => {
      expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  it("drops unmet lines with hideUnmet and keeps the met ones", () => {
    renderComponent(
      <FieldRules rules={usernameRules("ab")} visible hideUnmet />,
    );
    expect(screen.queryByText("3–30 characters")).toBeNull();
    expect(screen.getByText("Letters, numbers or _")).toBeTruthy();
  });

  it("renders nothing when hideUnmet leaves no line", () => {
    const { container } = renderComponent(
      <FieldRules rules={passwordRules("abc")} visible hideUnmet />,
    );
    expect(container.textContent).toBe("");
  });

  it("does not announce rules already met on mount", () => {
    renderComponent(<FieldRules rules={usernameRules("chef_1")} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces once when a rule flips to met, not on a keystroke that keeps it met", () => {
    const { rerender } = renderComponent(
      <FieldRules rules={passwordRules("1234567")} visible />,
    );
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();

    rerender(<FieldRules rules={passwordRules("12345678")} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith("At least 8 characters, done");

    rerender(<FieldRules rules={passwordRules("123456789")} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("never announces a rule going unmet", () => {
    const { rerender } = renderComponent(
      <FieldRules rules={passwordRules("12345678")} visible />,
    );
    rerender(<FieldRules rules={passwordRules("1234567")} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces a flip hidden by hideUnmet the moment it is met", () => {
    const { rerender } = renderComponent(
      <FieldRules rules={passwordRules("1234567")} visible hideUnmet />,
    );
    rerender(<FieldRules rules={passwordRules("12345678")} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("does not announce a flip while hidden, nor later when shown", () => {
    const { rerender } = renderComponent(
      <FieldRules rules={passwordRules("1234567")} visible={false} />,
    );
    rerender(<FieldRules rules={passwordRules("12345678")} visible={false} />);
    rerender(<FieldRules rules={passwordRules("12345678")} visible />);
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();
  });
});
