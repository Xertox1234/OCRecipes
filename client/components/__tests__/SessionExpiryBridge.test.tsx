// @vitest-environment jsdom
import { render } from "@testing-library/react";

import { SessionExpiryBridge } from "../SessionExpiryBridge";

const { mockSubscribe, mockExpireSession, mockToastError, authState } =
  vi.hoisted(() => ({
    mockSubscribe: vi.fn(),
    mockExpireSession: vi.fn(),
    mockToastError: vi.fn(),
    authState: { isAuthenticated: true },
  }));

vi.mock("@/lib/query-client", () => ({
  subscribeToSessionExpiry: (listener: () => void) => mockSubscribe(listener),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    isAuthenticated: authState.isAuthenticated,
    expireSession: mockExpireSession,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

const EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

describe("SessionExpiryBridge", () => {
  let capturedListener: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = undefined;
    authState.isAuthenticated = true;
    mockSubscribe.mockImplementation((listener: () => void) => {
      capturedListener = listener;
      return () => {};
    });
    mockExpireSession.mockResolvedValue(undefined);
  });

  it("expires the session and shows a toast when a 401 fires while authenticated", () => {
    render(<SessionExpiryBridge />);

    capturedListener?.();

    expect(mockExpireSession).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(EXPIRED_MESSAGE);
  });

  it("ignores the event when there is no live session (not authenticated)", () => {
    authState.isAuthenticated = false;
    render(<SessionExpiryBridge />);

    capturedListener?.();

    // No session to expire and no scary 'session expired' message — e.g. a
    // stray 401 during cold launch before checkAuth resolves.
    expect(mockExpireSession).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("unsubscribes from the emitter on unmount", () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockImplementation((listener: () => void) => {
      capturedListener = listener;
      return unsubscribe;
    });

    const { unmount } = render(<SessionExpiryBridge />);
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
