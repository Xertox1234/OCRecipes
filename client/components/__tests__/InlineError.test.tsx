// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { InlineError } from "../InlineError";

const { a11y, withSequenceSpy } = vi.hoisted(() => ({
  a11y: { reducedMotion: false },
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

beforeEach(() => {
  a11y.reducedMotion = false;
  withSequenceSpy.mockClear();
});

describe("InlineError", () => {
  it("renders null for null message", () => {
    const { container } = renderComponent(<InlineError message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null for undefined message", () => {
    const { container } = renderComponent(<InlineError message={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null for empty string message", () => {
    const { container } = renderComponent(<InlineError message="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders message text when provided", () => {
    renderComponent(<InlineError message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("has accessibilityRole alert", () => {
    renderComponent(<InlineError message="Error occurred" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});

// The shake is for validation rejects: the form bumps `shakeKey` on each one.
// A counter, not the message, so the same reject twice shakes twice (the
// form's setError("") + setError(same) batches to no change).
describe("InlineError — shake", () => {
  it("shakes on the first reject, when the message appears", () => {
    const { rerender } = renderComponent(
      <InlineError message="" shakeKey={0} />,
    );
    rerender(<InlineError message="Username is required" shakeKey={1} />);
    expect(screen.getByText("Username is required")).toBeDefined();
    expect(withSequenceSpy).toHaveBeenCalledTimes(1);
  });

  it("shakes again when the same reject repeats", () => {
    const { rerender } = renderComponent(
      <InlineError message="Username is required" shakeKey={1} />,
    );
    rerender(<InlineError message="Username is required" shakeKey={2} />);
    rerender(<InlineError message="Username is required" shakeKey={3} />);
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
  });

  it("does not shake on mount, even with an error showing", () => {
    renderComponent(
      <InlineError message="Username is required" shakeKey={4} />,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });

  it("does not shake when only the message changes (a server error)", () => {
    const { rerender } = renderComponent(
      <InlineError message="" shakeKey={0} />,
    );
    rerender(<InlineError message="Incorrect password" shakeKey={0} />);
    expect(screen.getByText("Incorrect password")).toBeDefined();
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });

  it("does not shake under reduced motion, and still shows the error", () => {
    a11y.reducedMotion = true;
    const { rerender } = renderComponent(
      <InlineError message="" shakeKey={0} />,
    );
    rerender(<InlineError message="Username is required" shakeKey={1} />);
    expect(screen.getByText("Username is required")).toBeDefined();
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});
