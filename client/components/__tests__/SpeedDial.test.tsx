// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { BackHandler, Platform } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { SpeedDial } from "../SpeedDial";

describe("SpeedDial", () => {
  const mockActions = [
    { icon: "camera", label: "Camera Scan", onPress: vi.fn() },
    { icon: "edit-3", label: "Quick Log", onPress: vi.fn() },
  ];

  it("renders all action labels", () => {
    renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
    expect(screen.getByText("Camera Scan")).toBeDefined();
    expect(screen.getByText("Quick Log")).toBeDefined();
  });

  // Device-confirmed 2026-08-17 on a physical iPhone with VoiceOver: focus
  // landed on the full-screen backdrop and interleaved between the action
  // items, and activating it dismissed the menu WITHOUT navigating — the
  // reported "it just closes the screen". See
  // todos/P1-2026-08-07-scan-flow-unreachable-with-voiceover.md.
  //
  // What jsdom can and cannot observe here (per docs/solutions/conventions/
  // jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding): the mock maps the
  // paired hiding props to aria-hidden, and ByRole excludes aria-hidden nodes
  // — so ROLE-CARRYING elements (the backdrop Pressable) are count-assertable.
  // The label pill's View/Text never carry a role in EITHER state, so no
  // ByRole query can see them; their hiding is asserted via testID +
  // aria-hidden, and "RN Text is independently focusable under VoiceOver" is
  // covered only by the device pass + Android uiautomator dump recorded in
  // todos/deployment/voiceover-scan-device-pass.md. Both anti-vacuity repairs
  // here are mutation-verified: reverting the hiding props flips them red
  // (review finding 2026-08-17 — the earlier name-filtered ByRole versions
  // stayed green with the fix reverted).
  describe("accessibility tree membership", () => {
    it("keeps the dismissal backdrop out of the accessibility tree", () => {
      renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
      // Count, not name-filtered: the backdrop no longer HAS a label, so a
      // name query can never match it and would pass vacuously. The Pressable
      // mock hardcodes role="button", so the only thing excluding the
      // backdrop from this count is aria-hidden — exactly the fix.
      expect(screen.getAllByRole("button")).toHaveLength(mockActions.length);
    });

    it("still dismisses on a sighted press of the backdrop", () => {
      // The backdrop is hidden from assistive tech but must remain tappable —
      // hiding it by unmounting it or by pointerEvents would break
      // tap-to-close for sighted users.
      //
      // Targeted by testID, NOT by querySelector('[aria-hidden="true"]'):
      // that selector matches the FIRST hidden node, which is the label pill
      // once both are hidden. It passed for the wrong reason until a
      // deliberate revert exposed it.
      const onClose = vi.fn();
      renderComponent(<SpeedDial actions={mockActions} onClose={onClose} />);

      const backdrop = screen.getByTestId("speed-dial-backdrop");
      // Paired presence assertion (see docs/solutions/conventions/
      // jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding, rule 1a): proves
      // the node exists and is the hidden one, so the ByRole absence test
      // above cannot pass merely by matching nothing.
      expect(backdrop.getAttribute("aria-hidden")).toBe("true");

      backdrop.click();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("hides every action's label pill from the accessibility tree", () => {
      // Regression guard for the decoy label pill: the pill Text and the
      // mini-FAB both announced the same name, so half of every action's
      // VoiceOver stops did nothing when activated. User-reported verbatim:
      // "it announces everything twice. Once for the text and once for the
      // button."
      //
      // Asserted via testID + aria-hidden, NOT ByRole: the pill's View/Text
      // carry no role in either state, so a role query can never see them and
      // passed identically against the pre-fix code (mutation-proven).
      renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
      const pills = screen.getAllByTestId("speed-dial-action-label");
      expect(pills).toHaveLength(mockActions.length);
      for (const pill of pills) {
        expect(pill.getAttribute("aria-hidden")).toBe("true");
      }
    });

    it("routes an action press to that action's own handler", () => {
      renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
      screen.getByRole("button", { name: "Camera Scan" }).click();
      expect(mockActions[0].onPress).toHaveBeenCalledTimes(1);
      expect(mockActions[1].onPress).not.toHaveBeenCalled();
    });
  });

  // Hiding the backdrop lets accessibilityViewIsModal finally contain focus,
  // which also stops the FAB leaking into the menu's focus order. That removes
  // the last swipe-reachable exit, so each platform needs its own: iOS gets
  // onAccessibilityEscape, Android gets hardware back. Without this, a
  // TalkBack user who wants none of the actions is stuck in the menu.
  describe("dismissal paths", () => {
    const originalOS = Platform.OS;
    afterEach(() => {
      Object.defineProperty(Platform, "OS", { value: originalOS });
      vi.mocked(BackHandler.addEventListener).mockClear();
    });

    function setOS(os: string) {
      Object.defineProperty(Platform, "OS", { value: os });
    }

    it("closes on Android hardware back and consumes the event", () => {
      setOS("android");
      const onClose = vi.fn();
      renderComponent(<SpeedDial actions={mockActions} onClose={onClose} />);

      const [event, handler] = vi.mocked(BackHandler.addEventListener).mock
        .calls[0] as unknown as [string, () => boolean];
      expect(event).toBe("hardwareBackPress");

      // Returning true is load-bearing: a falsy return lets the press fall
      // through and pop the screen underneath as well as closing the menu.
      expect(handler()).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes the back handler when the menu unmounts", () => {
      setOS("android");
      const remove = vi.fn();
      vi.mocked(BackHandler.addEventListener).mockReturnValueOnce({
        remove,
      } as unknown as ReturnType<typeof BackHandler.addEventListener>);

      const { unmount } = renderComponent(
        <SpeedDial actions={mockActions} onClose={vi.fn()} />,
      );
      unmount();
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("registers no back handler on iOS", () => {
      setOS("ios");
      renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
      expect(BackHandler.addEventListener).not.toHaveBeenCalled();
    });
  });
});
