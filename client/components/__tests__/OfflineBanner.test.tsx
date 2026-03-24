// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { OfflineBanner } from "../OfflineBanner";

const { mockUseNetworkStatus, mockToast } = vi.hoisted(() => ({
  mockUseNetworkStatus: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: mockUseNetworkStatus,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => mockToast,
}));

describe("OfflineBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({
      isOffline: false,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });
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
    expect(mockToast.success).toHaveBeenCalledWith("Back online");
  });

  it("calls clearWasOffline after showing toast", () => {
    const mockClearWasOffline = vi.fn();
    mockUseNetworkStatus.mockReturnValue({
      isOffline: false,
      wasOffline: true,
      clearWasOffline: mockClearWasOffline,
    });

    renderComponent(<OfflineBanner />);
    expect(mockToast.success).toHaveBeenCalledWith("Back online");
    expect(mockClearWasOffline).toHaveBeenCalled();
  });
});
