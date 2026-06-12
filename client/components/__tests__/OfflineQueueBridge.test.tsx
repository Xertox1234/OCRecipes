// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { OfflineQueueBridge } from "../OfflineQueueBridge";

const { mockToastError, mockSubscribe } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockSubscribe: vi.fn(),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

vi.mock("@/lib/offline-queue-drain", () => ({
  subscribeToQueueDrainErrors: mockSubscribe,
}));

describe("OfflineQueueBridge", () => {
  let capturedListener: ((msg: string) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = undefined;
    mockSubscribe.mockImplementation((listener: (msg: string) => void) => {
      capturedListener = listener;
      return () => {};
    });
  });

  it("shows a toast when a drain error is emitted", () => {
    render(<OfflineQueueBridge />);
    expect(capturedListener).toBeDefined();
    capturedListener?.("A queued item couldn't be synced and was discarded.");
    expect(mockToastError).toHaveBeenCalledWith(
      "A queued item couldn't be synced and was discarded.",
    );
  });

  it("renders nothing", () => {
    const { container } = render(<OfflineQueueBridge />);
    expect(container.firstChild).toBeNull();
  });

  it("unsubscribes from the emitter on unmount", () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockImplementation((listener: (msg: string) => void) => {
      capturedListener = listener;
      return unsubscribe;
    });

    const { unmount } = render(<OfflineQueueBridge />);
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
