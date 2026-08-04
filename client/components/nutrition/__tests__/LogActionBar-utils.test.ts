import { describe, it, expect } from "vitest";

import { deriveLogBarState } from "../LogActionBar-utils";

describe("deriveLogBarState", () => {
  it("shows the acknowledge button while the gate is unmet", () => {
    const state = deriveLogBarState({
      logGate: {
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      },
      acknowledged: false,
      productName: "Cherry Coke",
    });
    expect(state.mode).toBe("acknowledge");
    expect(state.label).toBe("Review values before logging");
    expect(state.accessibilityLabel).toBe(
      "Review values before logging. These values come from the product database, not the label you photographed.",
    );
  });

  it("shows the log button once acknowledged", () => {
    const state = deriveLogBarState({
      logGate: {
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      },
      acknowledged: true,
      productName: "Cherry Coke",
    });
    expect(state.mode).toBe("log");
    expect(state.label).toBe("Add to Today");
    expect(state.accessibilityLabel).toBe(
      "Add Cherry Coke to today's food log",
    );
  });

  it("shows the log button when the gate does not apply at all", () => {
    const state = deriveLogBarState({
      logGate: { kind: "open", buttonLabel: "Add to Today" },
      acknowledged: false,
      productName: "Cherry Coke",
    });
    expect(state.mode).toBe("log");
  });

  it("falls back to 'item' when there is no product name", () => {
    const state = deriveLogBarState({
      logGate: { kind: "open", buttonLabel: "Add to Today" },
      acknowledged: false,
      productName: undefined,
    });
    expect(state.accessibilityLabel).toBe("Add item to today's food log");
  });
});
