// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import {
  SkeletonBox,
  SkeletonItem,
  SkeletonList,
  SkeletonLoadingRegion,
  SkeletonProvider,
} from "../SkeletonLoader";

describe("SkeletonBox", () => {
  it("renders a div element", () => {
    const { container } = renderComponent(<SkeletonBox />);
    expect(container.firstChild).toBeDefined();
  });

  it("accepts custom dimensions", () => {
    const { container } = renderComponent(
      <SkeletonBox width={200} height={32} />,
    );
    expect(container.firstChild).toBeDefined();
  });

  it("renders standalone when no provider wraps it", () => {
    // No provider → each box owns its own shimmer timer (fallback path).
    const { container } = renderComponent(<SkeletonBox />);
    expect(container.firstChild).toBeDefined();
  });

  it("renders inside a SkeletonProvider (shared driver path)", () => {
    const { container } = renderComponent(
      <SkeletonProvider>
        <SkeletonBox />
        <SkeletonBox />
        <SkeletonBox />
      </SkeletonProvider>,
    );
    // Provider wraps children; all three boxes share one shimmer driver.
    expect(container.firstChild).toBeDefined();
  });
});

describe("SkeletonProvider", () => {
  it("renders its children", () => {
    renderComponent(
      <SkeletonProvider>
        <span>child content</span>
      </SkeletonProvider>,
    );
    expect(screen.getByText("child content")).toBeDefined();
  });
});

describe("SkeletonItem", () => {
  // Rule 1a pairing: the presence half. Proves `testID="skeleton-item"` is
  // wired, so the absence assertion below means something.
  it("renders its root as testID skeleton-item", () => {
    renderComponent(<SkeletonItem />);
    expect(screen.getByTestId("skeleton-item")).toBeDefined();
  });

  // Rule 1a pairing: the absence half. SkeletonItem is only ever rendered
  // inside SkeletonList's SkeletonLoadingRegion, which hides the whole
  // subtree and announces "Loading" once for the list — a per-item label
  // would be unreachable (nested in a hidden region) or, if it were
  // reachable, one of several identical announced labels. Fails on main
  // (SkeletonItem currently sets `accessibilityLabel="Loading..."`).
  it("does not carry its own Loading accessibility label", () => {
    renderComponent(<SkeletonItem />);
    expect(screen.queryByLabelText("Loading...")).toBeNull();
  });

  it("renders default content with multiple child elements", () => {
    renderComponent(<SkeletonItem />);
    const item = screen.getByTestId("skeleton-item");
    expect(item.childNodes.length).toBeGreaterThan(0);
  });

  it("renders custom children instead of default content", () => {
    renderComponent(
      <SkeletonItem>
        <span>Custom skeleton</span>
      </SkeletonItem>,
    );
    expect(screen.getByText("Custom skeleton")).toBeDefined();
  });
});

describe("SkeletonList", () => {
  it("renders 5 items by default", () => {
    renderComponent(<SkeletonList />);
    expect(screen.getAllByTestId("skeleton-item")).toHaveLength(5);
  });

  it("renders custom count of items", () => {
    renderComponent(<SkeletonList count={3} />);
    expect(screen.getAllByTestId("skeleton-item")).toHaveLength(3);
  });

  it("uses custom renderItem when provided", () => {
    renderComponent(
      <SkeletonList
        count={2}
        renderItem={(i) => <span key={i}>Item {i}</span>}
      />,
    );
    expect(screen.getByText("Item 0")).toBeDefined();
    expect(screen.getByText("Item 1")).toBeDefined();
  });

  // Fails on main: SkeletonList's container has no hide props at all today,
  // so it carries neither `aria-hidden` nor the region testID.
  it("hides the whole list from screen readers as one region", () => {
    renderComponent(<SkeletonList count={3} />);
    const region = screen.getByTestId("skeleton-list");
    expect(region.getAttribute("aria-hidden")).toBe("true");
  });

  // Fails on main: today each of the 5 default items carries its own
  // "Loading..." label (SkeletonItem), so this resolves 5 matches instead
  // of 0 — the exact per-item announcement noise this todo removes.
  it("does not expose a per-item Loading label", () => {
    renderComponent(<SkeletonList />);
    expect(screen.queryAllByLabelText("Loading...")).toHaveLength(0);
  });
});

describe("SkeletonLoadingRegion", () => {
  it("renders its children", () => {
    renderComponent(
      <SkeletonLoadingRegion>
        <span>region content</span>
      </SkeletonLoadingRegion>,
    );
    expect(screen.getByText("region content")).toBeDefined();
  });

  // The iOS half (`accessibilityElementsHidden`) and the Android half
  // (`importantForAccessibility="no-hide-descendants"`) both OR into the
  // same `aria-hidden` attribute in this harness (ariaHiddenProps in
  // test/mocks/react-native.ts) — this proves at least one hiding prop is
  // set, not which platform is covered. See the jsdom a11y-tree-hiding
  // solution doc's "Scope limit" note.
  it("marks the region aria-hidden", () => {
    renderComponent(
      <SkeletonLoadingRegion testID="region">
        <span>content</span>
      </SkeletonLoadingRegion>,
    );
    expect(screen.getByTestId("region").getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
