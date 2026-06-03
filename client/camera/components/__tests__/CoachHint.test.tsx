// @vitest-environment jsdom
/**
 * H2 (2026-06-03 full audit): CoachHint announces phase-transition hints to
 * VoiceOver on iOS, but must (a) skip the mount-time announce via
 * `isFirstRenderRef` to avoid noise when the camera screen first appears, and
 * (b) stay silent on Android — the Animated.Text carries
 * accessibilityLiveRegion="polite", so an iOS announce would double-announce.
 * See docs/rules/accessibility.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import * as RN from "react-native";
import { CoachHint } from "../CoachHint";

describe("CoachHint — announce gating (H2)", () => {
  const originalPlatformOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
    announceSpy.mockRestore();
  });

  it("does not announce the initial hint on mount (iOS)", () => {
    RN.Platform.OS = "ios";
    render(<CoachHint message="Point at a nutrition label" />);

    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("announces a changed hint to VoiceOver on iOS", () => {
    RN.Platform.OS = "ios";
    const { rerender } = render(
      <CoachHint message="Point at a nutrition label" />,
    );

    rerender(<CoachHint message="Hold steady" />);

    expect(announceSpy).toHaveBeenCalledWith("Hold steady");
  });

  it("does not announce on Android (the hint's live region handles it)", () => {
    RN.Platform.OS = "android";
    const { rerender } = render(
      <CoachHint message="Point at a nutrition label" />,
    );

    rerender(<CoachHint message="Hold steady" />);

    expect(announceSpy).not.toHaveBeenCalled();
  });
});
