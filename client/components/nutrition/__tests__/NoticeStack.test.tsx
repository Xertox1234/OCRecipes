// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccessibilityInfo } from "react-native";
import { FadeInUp } from "react-native-reanimated";

import { renderComponent } from "../../../../test/utils/render-component";
import { NoticeStack } from "../NoticeStack";

describe("NoticeStack", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders each notice's title and body", () => {
    const { queryByText } = renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo
      />,
    );
    expect(queryByText("Label not used")).toBeTruthy();
    expect(queryByText("Calories disagreed.")).toBeTruthy();
    expect(
      queryByText(
        "Values shown per 100g. Check package for actual serving size.",
      ),
    ).toBeTruthy();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = renderComponent(
      <NoticeStack
        labelReadNotice={null}
        correctionNotice={null}
        showPer100gInfo={false}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("carries NO live region on the container or any row", () => {
    // A "polite" region on a container wrapping multiple variants makes
    // TalkBack recompose the whole subtree on any descendant change.
    const { container } = renderComponent(
      <NoticeStack labelReadNotice="a" correctionNotice="b" showPer100gInfo />,
    );
    expect(container.querySelectorAll("[aria-live]").length).toBe(0);
  });

  it("announces once when notices appear", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("re-announces when the content changes but the notice kind does not", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    const { rerender } = renderComponent(
      <NoticeStack
        labelReadNotice={null}
        correctionNotice="corrected to 30 g"
        showPer100gInfo={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    rerender(
      <NoticeStack
        labelReadNotice={null}
        correctionNotice="corrected to 45 g"
        showPer100gInfo={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("does not re-announce on a re-render with identical content", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    const props = {
      labelReadNotice: "same" as const,
      correctionNotice: null,
      showPer100gInfo: false,
    };
    const { rerender } = renderComponent(<NoticeStack {...props} />);
    rerender(<NoticeStack {...props} />);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("skips the entrance animation when reducedMotion is true", () => {
    // The jsdom Reanimated mock (test/mocks/react-native-reanimated.ts) strips
    // `entering`/`exiting`/`layout` from the DOM entirely, so the `entering`
    // prop's value isn't directly queryable. Spying on `FadeInUp.delay` — the
    // entry point of the chain the non-reduced branch calls — is the
    // observable proxy: called means an entrance animation was built, not
    // called means `entering` was left `undefined`.
    const delaySpy = vi.spyOn(FadeInUp, "delay");
    renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
        reducedMotion
      />,
    );
    expect(delaySpy).not.toHaveBeenCalled();
  });

  it("builds the entrance animation when reducedMotion is false", () => {
    const delaySpy = vi.spyOn(FadeInUp, "delay");
    renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
        reducedMotion={false}
      />,
    );
    expect(delaySpy).toHaveBeenCalledWith(150);
  });
});
