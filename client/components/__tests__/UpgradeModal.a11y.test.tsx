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

// P3-2026-06-24: on open, the OS focus shift reads only the first accessible
// element (the close button, "Close upgrade modal"), giving a screen-reader user
// no context for why the modal appeared. The modal must announce its purpose on
// the visible false→true edge. The idle title carries no live region (gated to
// success), so this announce fires on BOTH platforms with no iOS gate, and is
// delayed past the slide-present focus shift so VoiceOver doesn't swallow it.
describe("UpgradeModal — on-open purpose announce a11y", () => {
  const originalPlatformOS = RN.Platform.OS;
  const PURPOSE = "Upgrade to Premium. Unlock the full OCRecipes experience.";
  let announceSpy: ReturnType<typeof vi.spyOn>;

  const countPurposeCalls = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((call: unknown[]) => call[0] === PURPOSE).length;

  beforeEach(() => {
    purchaseState.current = { status: "idle" };
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    RN.Platform.OS = originalPlatformOS;
    announceSpy.mockRestore();
  });

  it("announces the modal's purpose when it opens (iOS)", () => {
    RN.Platform.OS = "ios";
    const { rerender } = renderComponent(
      <UpgradeModal visible={false} onClose={vi.fn()} />,
    );
    expect(announceSpy).not.toHaveBeenCalledWith(PURPOSE);

    rerender(<UpgradeModal visible onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);

    expect(announceSpy).toHaveBeenCalledWith(PURPOSE);
  });

  it("announces the modal's purpose when it opens (Android — no iOS gate)", () => {
    RN.Platform.OS = "android";
    const { rerender } = renderComponent(
      <UpgradeModal visible={false} onClose={vi.fn()} />,
    );

    rerender(<UpgradeModal visible onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);

    expect(announceSpy).toHaveBeenCalledWith(PURPOSE);
  });

  it("does not announce on mount while hidden", () => {
    RN.Platform.OS = "ios";
    renderComponent(<UpgradeModal visible={false} onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);

    expect(announceSpy).not.toHaveBeenCalledWith(PURPOSE);
  });

  it("announces once per open and re-arms on a full close→reopen", () => {
    RN.Platform.OS = "ios";
    // Open via the real false→true edge (not a mount-while-visible shortcut, so
    // it exercises the prev-ref edge guard and is StrictMode-robust)…
    const { rerender } = renderComponent(
      <UpgradeModal visible={false} onClose={vi.fn()} />,
    );
    rerender(<UpgradeModal visible onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);
    // …a re-render while still visible must NOT re-announce…
    rerender(<UpgradeModal visible onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);
    expect(countPurposeCalls(announceSpy)).toBe(1);

    // …a real close then reopen must re-arm and announce again (every genuine
    // open speaks — the prev-ref resets to false on the true→false leg).
    rerender(<UpgradeModal visible={false} onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);
    rerender(<UpgradeModal visible onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);
    expect(countPurposeCalls(announceSpy)).toBe(2);
  });

  it("does not announce if the modal closes before the announce delay elapses", () => {
    RN.Platform.OS = "ios";
    const { rerender } = renderComponent(
      <UpgradeModal visible={false} onClose={vi.fn()} />,
    );
    // Open, then close within the 500ms window — the effect cleanup must cancel
    // the pending timer so a stale announce can't fire after the modal is gone.
    rerender(<UpgradeModal visible onClose={vi.fn()} />);
    vi.advanceTimersByTime(200);
    rerender(<UpgradeModal visible={false} onClose={vi.fn()} />);
    vi.advanceTimersByTime(500);

    expect(announceSpy).not.toHaveBeenCalledWith(PURPOSE);
  });
});
