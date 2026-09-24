// @vitest-environment jsdom
import React from "react";
import { act, screen } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { Toast } from "../Toast";
import { Colors } from "@/constants/theme";

const mockDismiss = vi.fn();

describe("Toast", () => {
  beforeEach(() => {
    mockDismiss.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders message text", () => {
    renderComponent(
      <Toast
        message="Item saved"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText("Item saved")).toBeDefined();
  });

  it("has correct accessibility label", () => {
    renderComponent(
      <Toast
        message="Something went wrong"
        variant="error"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByLabelText("Something went wrong")).toBeDefined();
  });

  it("renders with info variant", () => {
    renderComponent(
      <Toast
        message="Tip: try scanning"
        variant="info"
        theme={Colors.dark}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText("Tip: try scanning")).toBeDefined();
  });

  it("has polite live region for accessibility", () => {
    renderComponent(
      <Toast
        message="Test toast"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    const toast = screen.getByLabelText("Test toast");
    expect(toast.getAttribute("aria-live")).toBe("polite");
  });

  it("auto-dismisses after 3 seconds", () => {
    renderComponent(
      <Toast
        message="Auto dismiss"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    expect(mockDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    // onDismiss is called via runOnJS in animation callback or directly in reduced motion
    // With mocked reanimated, the withTiming callback fires synchronously
    expect(mockDismiss).toHaveBeenCalled();
  });

  it("renders action button when action prop is provided", () => {
    const mockAction = vi.fn();
    renderComponent(
      <Toast
        message="Item removed"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
        action={{ label: "Undo", onPress: mockAction }}
      />,
    );
    expect(screen.getByText("Item removed")).toBeDefined();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  it("auto-dismisses after 5 seconds when action is present", () => {
    renderComponent(
      <Toast
        message="Item removed"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
        action={{ label: "Undo", onPress: vi.fn() }}
      />,
    );
    expect(mockDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    // Should NOT have dismissed at 3s when action is present
    expect(mockDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    // Should dismiss at 5s
    expect(mockDismiss).toHaveBeenCalled();
  });

  // An `accessible` node collapses its whole subtree into one screen-reader
  // focus stop, so the action must NOT live under the node that carries the
  // message label. jsdom can't see `accessible` itself (see
  // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md);
  // the label travels with it, so its position is the observable proxy.
  describe("screen-reader reachability", () => {
    it("keeps the action button outside the labelled message group", () => {
      renderComponent(
        <Toast
          message="Upload failed"
          variant="error"
          theme={Colors.light}
          onDismiss={mockDismiss}
          action={{ label: "Retry", onPress: vi.fn() }}
        />,
      );
      const groups = screen.getAllByLabelText("Upload failed");
      expect(groups).toHaveLength(1);
      const button = screen.getByRole("button", { name: "Retry" });
      expect(groups[0].contains(button)).toBe(false);
      // The group still owns the live region and the message text.
      expect(groups[0].getAttribute("aria-live")).toBe("polite");
      expect(groups[0].textContent).toContain("Upload failed");
    });

    it("exposes exactly one labelled node for an action-less toast", () => {
      renderComponent(
        <Toast
          message="Item saved"
          variant="success"
          theme={Colors.light}
          onDismiss={mockDismiss}
        />,
      );
      const groups = screen.getAllByLabelText("Item saved");
      expect(groups).toHaveLength(1);
      expect(groups[0].getAttribute("aria-live")).toBe("polite");
      expect(groups[0].textContent).toContain("Item saved");
    });

    // Android does NOT collapse an `accessible` wrapper (device-verified
    // 2026-08-04, see CapturedPhotos.tsx), so TalkBack would read the group
    // label and then the raw message text again. The text must leave the
    // Android tree; the group label already carries the same string.
    it("hides the raw message text from the Android tree", () => {
      renderComponent(
        <Toast
          message="Upload failed"
          variant="error"
          theme={Colors.light}
          onDismiss={mockDismiss}
          action={{ label: "Retry", onPress: vi.fn() }}
        />,
      );
      const group = screen.getByLabelText("Upload failed");
      const text = screen.getByText("Upload failed");
      expect(group.contains(text)).toBe(true);
      expect(text.closest("[aria-hidden]")).not.toBeNull();
      expect(group.hasAttribute("aria-hidden")).toBe(false);
      expect(
        screen.getByRole("button", { name: "Retry" }).closest("[aria-hidden]"),
      ).toBeNull();
    });

    // The status icon repeats nothing beyond the message text that follows
    // it; unmarked it becomes its own screen-reader focus stop, hence
    // `importantForAccessibility="no-hide-descendants"` on Toast.tsx's
    // Feather. Selected via `data-icon` (the mock's declared contract, see
    // test/mocks/expo-vector-icons.ts) rather than a testID, since Toast.tsx
    // does not pass one to the icon and adding one would be a production
    // change outside this todo's scope. `accessible={false}` (also set on
    // the icon) has no jsdom-observable ARIA equivalent and stays
    // untranslated by design — see docs/solutions/conventions/
    // jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md —
    // so it is not asserted here. Scope limit: `aria-hidden` only proves SOME
    // hiding prop is set — the mock ORs the two — so swapping the icon's
    // `importantForAccessibility` (its only TalkBack hiding; iOS hides it via
    // the parent's `accessible` collapse) for `accessibilityElementsHidden`
    // would keep this green while Android regresses.
    it("hides the status icon from the accessibility tree", () => {
      const { container } = renderComponent(
        <Toast
          message="Item saved"
          variant="success"
          theme={Colors.light}
          onDismiss={mockDismiss}
        />,
      );
      const icon = container.querySelector('[data-icon="check-circle"]');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    });

    it("holds an action toast longer while a screen reader is on", async () => {
      vi.spyOn(RN.AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(
        true,
      );
      renderComponent(
        <Toast
          message="Upload failed"
          variant="error"
          theme={Colors.light}
          onDismiss={mockDismiss}
          action={{ label: "Retry", onPress: vi.fn() }}
        />,
      );
      // Let useAccessibility's isScreenReaderEnabled promise settle.
      await act(async () => {});
      vi.advanceTimersByTime(5000);
      expect(mockDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5000);
      expect(mockDismiss).toHaveBeenCalled();
    });

    it("keeps the 3s timeout for an action-less toast under a screen reader", async () => {
      vi.spyOn(RN.AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(
        true,
      );
      renderComponent(
        <Toast
          message="Item saved"
          variant="success"
          theme={Colors.light}
          onDismiss={mockDismiss}
        />,
      );
      await act(async () => {});
      vi.advanceTimersByTime(3000);
      expect(mockDismiss).toHaveBeenCalled();
    });
  });
});
