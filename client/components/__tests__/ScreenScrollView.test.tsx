// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import type { ScrollView } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { ScreenScrollView } from "../ScreenScrollView";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { mergeHeaderInsetStyle } from "../screen-scroll-view-utils";

vi.mock("@/hooks/useHeaderContentInset", () => ({
  useHeaderContentInset: vi.fn((extra: number = 0) => 88 + extra),
}));

vi.mock("../screen-scroll-view-utils", () => ({
  mergeHeaderInsetStyle: vi.fn((headerInset: number) => [
    { paddingTop: headerInset },
  ]),
}));

describe("ScreenScrollView", () => {
  it("renders children", () => {
    renderComponent(
      <ScreenScrollView>
        <span>Content</span>
      </ScreenScrollView>,
    );

    expect(screen.getByText("Content")).toBeDefined();
  });

  it("forwards a ref to the underlying ScrollView", () => {
    const ref = React.createRef<ScrollView>();

    renderComponent(
      <ScreenScrollView ref={ref}>
        <span>Content</span>
      </ScreenScrollView>,
    );

    expect(ref.current).not.toBeNull();
  });

  it("forwards headerInsetExtra into useHeaderContentInset", () => {
    renderComponent(
      <ScreenScrollView headerInsetExtra={20}>
        <span>Content</span>
      </ScreenScrollView>,
    );

    expect(useHeaderContentInset).toHaveBeenCalledWith(20);
  });

  it("passes the resolved inset and caller contentContainerStyle into mergeHeaderInsetStyle", () => {
    const callerStyle = { paddingBottom: 8 };

    renderComponent(
      <ScreenScrollView
        headerInsetExtra={20}
        contentContainerStyle={callerStyle}
      >
        <span>Content</span>
      </ScreenScrollView>,
    );

    expect(mergeHeaderInsetStyle).toHaveBeenCalledWith(108, callerStyle);
  });
});
