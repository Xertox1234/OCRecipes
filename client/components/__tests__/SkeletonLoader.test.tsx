// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SkeletonBox, SkeletonItem, SkeletonList } from "../SkeletonLoader";

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
});

describe("SkeletonItem", () => {
  it("renders with Loading accessibility label", () => {
    renderComponent(<SkeletonItem />);
    expect(screen.getByLabelText("Loading...")).toBeDefined();
  });

  it("renders default content with multiple child elements", () => {
    renderComponent(<SkeletonItem />);
    // SkeletonItem renders with Loading label and contains skeleton boxes
    expect(screen.getByLabelText("Loading...")).toBeDefined();
    expect(
      screen.getByLabelText("Loading...").childNodes.length,
    ).toBeGreaterThan(0);
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
    const items = screen.getAllByLabelText("Loading...");
    expect(items).toHaveLength(5);
  });

  it("renders custom count of items", () => {
    renderComponent(<SkeletonList count={3} />);
    const items = screen.getAllByLabelText("Loading...");
    expect(items).toHaveLength(3);
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
});
