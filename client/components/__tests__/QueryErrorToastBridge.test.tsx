// @vitest-environment jsdom
import { render } from "@testing-library/react";

import { QueryErrorToastBridge } from "../QueryErrorToastBridge";

// Auth-error filtering (401 / 4xx exclusion) is verified at the correct layer —
// shouldSurfaceQueryError + the QueryCache.onError gate — in
// client/lib/__tests__/query-error-net.test.ts. The bridge itself has no auth
// guard: it calls toast.error() for every message that reaches it.

const { mockSubscribe, mockToastError, mockToastInfo, mockSubscribePaused } =
  vi.hoisted(() => ({
    mockSubscribe: vi.fn(),
    mockToastError: vi.fn(),
    mockToastInfo: vi.fn(),
    mockSubscribePaused: vi.fn(),
  }));

vi.mock("@/lib/query-client", () => ({
  subscribeToQueryErrors: (listener: (message: string) => void) =>
    mockSubscribe(listener),
  subscribeToPausedMutations: (listener: () => void) =>
    mockSubscribePaused(listener),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError, info: mockToastInfo }),
}));

describe("QueryErrorToastBridge", () => {
  let capturedListener: ((message: string) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = undefined;
    mockSubscribePaused.mockReturnValue(() => {});
    mockSubscribe.mockImplementation((listener: (message: string) => void) => {
      capturedListener = listener;
      return () => {};
    });
  });

  it("subscribes to query-client error events on mount", () => {
    render(<QueryErrorToastBridge />);

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(capturedListener).toBeDefined();
  });

  it("calls toast.error with the message when a query error fires", () => {
    render(<QueryErrorToastBridge />);

    capturedListener?.(
      "Something went wrong loading your data. Please try again.",
    );

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Something went wrong loading your data. Please try again.",
      { haptic: false },
    );
  });

  it("unsubscribes from the emitter on unmount (no memory leak)", () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockImplementation((listener: (message: string) => void) => {
      capturedListener = listener;
      return unsubscribe;
    });

    const { unmount } = render(<QueryErrorToastBridge />);
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  // R19: an offline-paused mutation gets an explanation, not a silent spinner.
  it("explains an offline-paused action with an info toast", () => {
    let pausedListener: (() => void) | undefined;
    mockSubscribePaused.mockImplementation((listener: () => void) => {
      pausedListener = listener;
      return () => {};
    });
    render(<QueryErrorToastBridge />);

    pausedListener?.();

    expect(mockToastInfo).toHaveBeenCalledWith(
      "You're offline. This will finish when you reconnect.",
      { haptic: false },
    );
  });
});
