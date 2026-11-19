// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { OfflineBanner, OFFLINE_BANNER_VISIBLE_MS } from "../OfflineBanner";

const { mockUseNetworkStatus, mockToast, mockUseAccessibility } = vi.hoisted(
  () => ({
    mockUseNetworkStatus: vi.fn(),
    mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    mockUseAccessibility: vi.fn(),
  }),
);

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: mockUseNetworkStatus,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: mockUseAccessibility,
}));

describe("OfflineBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({
      isOffline: false,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });
    mockUseAccessibility.mockReturnValue({ reducedMotion: false });
  });

  it("returns null when online", () => {
    const { container } = renderComponent(<OfflineBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders banner text when offline", () => {
    mockUseNetworkStatus.mockReturnValue({
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });

    renderComponent(<OfflineBanner />);
    expect(
      screen.getByText("You're offline. Some features may be unavailable."),
    ).toBeDefined();
  });

  it("has accessibilityRole alert", () => {
    mockUseNetworkStatus.mockReturnValue({
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });

    renderComponent(<OfflineBanner />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("has accessibilityLiveRegion assertive", () => {
    mockUseNetworkStatus.mockReturnValue({
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });

    renderComponent(<OfflineBanner />);
    const banner = screen.getByRole("alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
  });

  it("shows back online toast when wasOffline transitions to online", () => {
    mockUseNetworkStatus.mockReturnValue({
      isOffline: false,
      wasOffline: true,
      clearWasOffline: vi.fn(),
    });

    renderComponent(<OfflineBanner />);
    expect(mockToast.success).toHaveBeenCalledWith("Back online", {
      haptic: false,
    });
  });

  it("renders correctly with reducedMotion enabled", () => {
    mockUseAccessibility.mockReturnValue({ reducedMotion: true });
    mockUseNetworkStatus.mockReturnValue({
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });

    renderComponent(<OfflineBanner />);
    expect(
      screen.getByText("You're offline. Some features may be unavailable."),
    ).toBeDefined();
  });

  describe("does not stay over the screen's top controls", () => {
    const OFFLINE_TEXT = "You're offline. Some features may be unavailable.";
    const offline = {
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("hides itself a few seconds after going offline", () => {
      mockUseNetworkStatus.mockReturnValue(offline);
      renderComponent(<OfflineBanner />);
      expect(screen.getByText(OFFLINE_TEXT)).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(OFFLINE_BANNER_VISIBLE_MS - 1);
      });
      expect(screen.queryByText(OFFLINE_TEXT)).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
    });

    it("hides at once when its dismiss button is tapped", () => {
      mockUseNetworkStatus.mockReturnValue(offline);
      renderComponent(<OfflineBanner />);

      // The button is its own accessibility node, outside the alert text.
      const button = screen.getByRole("button", {
        name: "Hide offline message",
      });
      expect(screen.getByRole("alert").contains(button)).toBe(false);
      fireEvent.click(button);
      expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
    });

    it("shows again the next time the device goes offline", () => {
      mockUseNetworkStatus.mockReturnValue(offline);
      const { rerender } = renderComponent(<OfflineBanner />);
      act(() => {
        vi.advanceTimersByTime(OFFLINE_BANNER_VISIBLE_MS);
      });
      expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();

      mockUseNetworkStatus.mockReturnValue({ ...offline, isOffline: false });
      rerender(<OfflineBanner />);
      mockUseNetworkStatus.mockReturnValue(offline);
      rerender(<OfflineBanner />);
      expect(screen.getByText(OFFLINE_TEXT)).toBeDefined();
    });
  });

  it("calls clearWasOffline after showing toast", () => {
    const mockClearWasOffline = vi.fn();
    mockUseNetworkStatus.mockReturnValue({
      isOffline: false,
      wasOffline: true,
      clearWasOffline: mockClearWasOffline,
    });

    renderComponent(<OfflineBanner />);
    expect(mockToast.success).toHaveBeenCalledWith("Back online", {
      haptic: false,
    });
    expect(mockClearWasOffline).toHaveBeenCalled();
  });
});
