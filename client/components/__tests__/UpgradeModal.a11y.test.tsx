// @vitest-environment jsdom
/**
 * H3 + item-3 (2026-06-03 full audit): UpgradeModal announces success/error state
 * transitions to VoiceOver on iOS, and exposes an assertive live region for
 * Android (where the imperative announce is suppressed to avoid double-announce).
 * See docs/rules/accessibility.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import * as RN from "react-native";
import type { PurchaseState } from "@shared/types/subscription";
import { renderComponent } from "../../../test/utils/render-component";
import { UpgradeModal } from "../UpgradeModal";

const { purchaseState } = vi.hoisted(() => ({
  purchaseState: { current: { status: "idle" } as PurchaseState },
}));

vi.mock("@/lib/iap/usePurchase", () => ({
  usePurchase: () => ({
    state: purchaseState.current,
    purchase: vi.fn(),
    restore: vi.fn(),
    reset: vi.fn(),
  }),
}));

function renderModal() {
  return renderComponent(<UpgradeModal visible onClose={vi.fn()} />);
}

describe("UpgradeModal — error state a11y", () => {
  const originalPlatformOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    purchaseState.current = {
      status: "error",
      error: { code: "NETWORK", message: "boom" },
    };
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
    announceSpy.mockRestore();
  });

  // Validates the test harness's accessibilityLiveRegion → aria-live mapping
  // against already-shipped production code (the error region exists pre-PR).
  it("renders the error with an assertive live region for Android", () => {
    RN.Platform.OS = "android";
    renderModal();

    const errorEl = screen.getByText(
      "Network error. Check your connection and try again.",
    );
    expect(errorEl.getAttribute("aria-live")).toBe("assertive");
  });

  it("announces the error to VoiceOver on iOS", () => {
    RN.Platform.OS = "ios";
    renderModal();

    expect(announceSpy).toHaveBeenCalledWith(
      "Network error. Check your connection and try again.",
    );
  });

  it("does not announce the error on Android (live region handles it)", () => {
    RN.Platform.OS = "android";
    renderModal();

    expect(announceSpy).not.toHaveBeenCalledWith(
      "Network error. Check your connection and try again.",
    );
  });
});

describe("UpgradeModal — success state a11y", () => {
  const originalPlatformOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    purchaseState.current = { status: "success" };
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
    announceSpy.mockRestore();
  });

  it("announces the success to VoiceOver on iOS", () => {
    RN.Platform.OS = "ios";
    renderModal();

    expect(announceSpy).toHaveBeenCalledWith("Welcome to Premium!");
  });

  it("does not announce the success on Android (live region handles it)", () => {
    RN.Platform.OS = "android";
    renderModal();

    expect(announceSpy).not.toHaveBeenCalledWith("Welcome to Premium!");
  });

  // item 3: parity with the error state — Android needs a live region for the
  // success confirmation since the imperative announce is iOS-only.
  it("exposes an assertive live region on the success confirmation for Android", () => {
    RN.Platform.OS = "android";
    renderModal();

    const successEl = screen.getByText("Welcome to Premium!", {
      selector: "[aria-live]",
    });
    expect(successEl.getAttribute("aria-live")).toBe("assertive");
  });
});
