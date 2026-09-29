// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { Text } from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import { CollapsibleSection } from "../CollapsibleSection";

// Captures the content wrapper's onLayout handler so tests can fire a
// measurement directly — jsdom performs no real layout, so RN's onLayout
// never fires on its own.
let capturedContentLayoutHandler: ((e: unknown) => void) | undefined;

vi.mock("react-native", async () => {
  const actual =
    await vi.importActual<typeof import("react-native")>("react-native");
  const RealView = actual.View as React.ElementType;
  const CapturingView = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      if (typeof props.onLayout === "function") {
        capturedContentLayoutHandler = props.onLayout as (e: unknown) => void;
      }
      return React.createElement(RealView, { ...props, ref });
    },
  );
  CapturingView.displayName = "CapturingView";
  return { ...actual, View: CapturingView };
});

// Stub useCollapsibleHeight so these tests assert on CollapsibleSection's OWN
// re-forwarding logic in isolation, not on Reanimated's native style
// application (which jsdom cannot exercise — see the todo this fixes,
// "Home: sections can show an expanded chevron with no rows on first load",
// for why a device-level check was required for the fix itself).
const mockOnContentLayout = vi.fn();
vi.mock("@/hooks/useCollapsibleHeight", () => ({
  useCollapsibleHeight: vi.fn(() => ({
    animatedStyle: {},
    onContentLayout: mockOnContentLayout,
  })),
}));

describe("CollapsibleSection", () => {
  const defaultProps = {
    title: "Camera & Scanning",
    isExpanded: true,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContentLayoutHandler = undefined;
  });

  it("renders section title", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Camera & Scanning")).toBeDefined();
  });

  it("renders children", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Child content")).toBeDefined();
  });

  it("calls onToggle when header is pressed", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Content</Text>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(defaultProps.onToggle).toHaveBeenCalledTimes(1);
  });

  it("has correct accessibility label", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Camera & Scanning section",
    );
  });

  it("renders chevron icon", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText("chevron-down")).toBeDefined();
  });

  // Regression coverage for "Home: sections can show an expanded chevron with
  // no rows on first load" (todos/archive/P3-2026-09-26-home-sections-expanded-
  // but-empty-on-first-load.md). Cold-launch device testing showed that a
  // shared-value write issued from useCollapsibleHeight's FIRST onLayout call
  // does not reliably reach the native view when a section is already
  // expanded on mount — the write can land before the React commit that
  // first attaches the driven Animated.View. Re-forwarding the same
  // measurement once more, in an effect (which runs after that commit), was
  // the one pattern that measurably fixed it on device (5/5, plus 2/2 with
  // Reduce Motion forced on). This test asserts the re-forward itself, since
  // jsdom cannot exercise the native timing race the fix responds to.
  it("re-forwards the first non-zero measurement once more after the commit, when already expanded", async () => {
    renderComponent(
      <CollapsibleSection {...defaultProps} isExpanded>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );

    await act(async () => {
      capturedContentLayoutHandler?.({
        nativeEvent: { layout: { height: 240 } },
      });
    });

    // Once synchronously (the real onLayout) and once more from the
    // post-commit effect once hasMeasuredOnce flips.
    expect(mockOnContentLayout).toHaveBeenCalledTimes(2);
    expect(mockOnContentLayout).toHaveBeenNthCalledWith(2, {
      nativeEvent: { layout: { height: 240 } },
    });
  });

  it("does not keep re-forwarding on later layout events", async () => {
    renderComponent(
      <CollapsibleSection {...defaultProps} isExpanded>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );

    await act(async () => {
      capturedContentLayoutHandler?.({
        nativeEvent: { layout: { height: 240 } },
      });
    });
    expect(mockOnContentLayout).toHaveBeenCalledTimes(2);

    // A later resize (e.g. content grows) goes through the ordinary path
    // only — hasMeasuredOnce is already true, so no further re-forwarding.
    act(() => {
      capturedContentLayoutHandler?.({
        nativeEvent: { layout: { height: 300 } },
      });
    });
    expect(mockOnContentLayout).toHaveBeenCalledTimes(3);
  });

  it("does not re-forward a zero-height (not-yet-rendered) measurement", async () => {
    renderComponent(
      <CollapsibleSection {...defaultProps} isExpanded>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );

    await act(async () => {
      capturedContentLayoutHandler?.({
        nativeEvent: { layout: { height: 0 } },
      });
    });

    expect(mockOnContentLayout).toHaveBeenCalledTimes(1);
  });
});
