// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { OfflineQueueBridge } from "../OfflineQueueBridge";

const { mockToastError, mockSubscribe, mockSubscribeEvictions } = vi.hoisted(
  () => ({
    mockToastError: vi.fn(),
    mockSubscribe: vi.fn(),
    mockSubscribeEvictions: vi.fn(),
  }),
);

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

vi.mock("@/lib/offline-queue-drain", () => ({
  subscribeToQueueDrainErrors: mockSubscribe,
}));

vi.mock("@/lib/offline-queue", () => ({
  subscribeToQueueEvictions: mockSubscribeEvictions,
}));

describe("OfflineQueueBridge", () => {
  let capturedListener: ((msg: string) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = undefined;
    mockSubscribeEvictions.mockReturnValue(() => {});
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
      { haptic: false },
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

  // R18: a queued write dropped by the depth cap or the TTL is reported.
  it("shows a toast when queued items are evicted unsynced", () => {
    let evictionListener: ((count: number) => void) | undefined;
    mockSubscribeEvictions.mockImplementation(
      (listener: (count: number) => void) => {
        evictionListener = listener;
        return () => {};
      },
    );
    render(<OfflineQueueBridge />);
    evictionListener?.(1);
    expect(mockToastError).toHaveBeenLastCalledWith(
      "An offline item couldn't be synced in time and was discarded.",
      { haptic: false },
    );
    evictionListener?.(3);
    expect(mockToastError).toHaveBeenLastCalledWith(
      "3 offline items couldn't be synced in time and were discarded.",
      { haptic: false },
    );
  });
});
