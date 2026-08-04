// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccessibilityInfo } from "react-native";

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

  it("does NOT announce when suppressed — the acknowledge announce must win", () => {
    // iOS UIAccessibility.post(.announcement) does not queue: two calls in one
    // commit and one is dropped. The casualty must never be the log gate's
    // acknowledge announce, which exists to stop a screen-reader user logging
    // unreviewed values. Asserting the STRING alone would pass when both fire.
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
        suppressAnnounce
      />,
    );
    expect(announce).toHaveBeenCalledTimes(0);
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

  it("does not retroactively announce unchanged content when suppression lifts", () => {
    // The brief covers suppression and content-change as separate axes but
    // never their intersection. Task 8 flips `suppressAnnounce` back to
    // false once its own acknowledge announcement finishes — if the notice
    // content hasn't changed in the meantime, that flip must stay silent:
    // content already "seen" while suppressed must not fire late.
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    const { rerender } = renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
        suppressAnnounce
      />,
    );
    expect(announce).toHaveBeenCalledTimes(0);
    rerender(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
        suppressAnnounce={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(0);
  });
});
