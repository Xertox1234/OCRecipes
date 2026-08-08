// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";

import { renderComponent } from "../../../../test/utils/render-component";
import { LogActionBar } from "../LogActionBar";
import type { LogGate } from "@/screens/nutrition-detail-utils";

const NEEDS_ACK: LogGate = {
  kind: "needsAcknowledgement",
  buttonLabel: "Review values before logging",
};
const OPEN: LogGate = { kind: "open" };

function baseProps(
  overrides: Partial<React.ComponentProps<typeof LogActionBar>> = {},
) {
  return {
    logGate: OPEN,
    productName: "Cherry Coke",
    isOffline: false,
    offlineLabel: (label: string) => label,
    isPending: false,
    onAddToLog: vi.fn(),
    onLayout: vi.fn(),
    ...overrides,
  };
}

/**
 * The RN jsdom mock (`test/mocks/react-native.ts`) forwards `onLayout`
 * straight onto the underlying `<div>`'s props via `mockComponent`'s
 * `...rest` spread. React never attaches it as a real DOM listener (it warns
 * "Unknown event handler property `onLayout`" and drops it), and jsdom has
 * no native layout event to dispatch anyway — so there is no way to fire it
 * through `fireEvent`. React still stores every prop it was given, including
 * ones it declined to wire up, on the host node's fiber under a
 * `__reactProps$…` key; reading it back and invoking it directly is the only
 * way to exercise this wiring without touching the shared mock (out of
 * scope for this task).
 */
function getReactOnLayout(node: Element): (event: unknown) => void {
  const propsKey = Object.keys(node).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!propsKey) {
    throw new Error(
      "Could not find React's internal props key on the node — the " +
        "__reactProps$ prefix may have changed in a React upgrade.",
    );
  }
  const props = (node as unknown as Record<string, Record<string, unknown>>)[
    propsKey
  ];
  const handler = props.onLayout;
  if (typeof handler !== "function") {
    throw new Error("onLayout prop was not a function on the bar's root node");
  }
  return handler as (event: unknown) => void;
}

describe("LogActionBar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the acknowledge button first; pressing it swaps to the log button", () => {
    const { getByText, queryByText, getByRole } = renderComponent(
      <LogActionBar {...baseProps({ logGate: NEEDS_ACK })} />,
    );
    expect(getByText("Review values before logging")).toBeTruthy();
    expect(queryByText("Add to Today")).toBeNull();

    fireEvent.click(getByRole("button"));

    expect(getByText("Add to Today")).toBeTruthy();
    expect(queryByText("Review values before logging")).toBeNull();
  });

  it("calls AccessibilityInfo.announceForAccessibility exactly once when acknowledge is pressed", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    const { getByRole } = renderComponent(
      <LogActionBar {...baseProps({ logGate: NEEDS_ACK })} />,
    );

    fireEvent.click(getByRole("button"));

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Values confirmed. Add to Today is now available.",
    );
  });

  it("reports its measured height through onLayout", () => {
    const onLayout = vi.fn();
    const { getByTestId } = renderComponent(
      <LogActionBar {...baseProps({ onLayout })} />,
    );

    const bar = getByTestId("log-action-bar");
    getReactOnLayout(bar)({ nativeEvent: { layout: { height: 96 } } });

    expect(onLayout).toHaveBeenCalledWith(96);
  });

  it("renders the offline caption when isOffline is true, and not otherwise", () => {
    const { queryByText, rerender } = renderComponent(
      <LogActionBar {...baseProps({ isOffline: true })} />,
    );
    expect(
      queryByText("You're offline. This will sync when you reconnect."),
    ).toBeTruthy();

    rerender(<LogActionBar {...baseProps({ isOffline: false })} />);
    expect(
      queryByText("You're offline. This will sync when you reconnect."),
    ).toBeNull();
  });

  it("fires onAddToLog on the log button press and NOT on the acknowledge press", () => {
    const onAddToLog = vi.fn();
    const { getByRole, getByText } = renderComponent(
      <LogActionBar {...baseProps({ logGate: NEEDS_ACK, onAddToLog })} />,
    );

    fireEvent.click(getByRole("button"));
    expect(onAddToLog).not.toHaveBeenCalled();

    expect(getByText("Add to Today")).toBeTruthy();
    fireEvent.click(getByRole("button"));
    expect(onAddToLog).toHaveBeenCalledTimes(1);
  });
});
