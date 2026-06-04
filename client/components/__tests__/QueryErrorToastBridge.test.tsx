// @vitest-environment jsdom
import { render } from "@testing-library/react";

import { QueryErrorToastBridge } from "../QueryErrorToastBridge";

// Auth-error filtering (401 / 4xx exclusion) is verified at the correct layer —
// shouldSurfaceQueryError + the QueryCache.onError gate — in
// client/lib/__tests__/query-error-net.test.ts. The bridge itself has no auth
// guard: it calls toast.error() for every message that reaches it.

const { mockSubscribe, mockToastError } = vi.hoisted(() => ({
  mockSubscribe: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  subscribeToQueryErrors: (listener: (message: string) => void) =>
    mockSubscribe(listener),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

describe("QueryErrorToastBridge", () => {
  let capturedListener: ((message: string) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = undefined;
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
});
