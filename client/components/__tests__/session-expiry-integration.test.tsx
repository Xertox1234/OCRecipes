// @vitest-environment jsdom
import { render, screen, waitFor, act } from "@testing-library/react";

import { AuthProvider, useAuthContext } from "@/context/AuthContext";
import { SessionExpiryBridge } from "@/components/SessionExpiryBridge";
import { apiRequest } from "@/lib/query-client";

/**
 * End-to-end wiring test: REAL useAuth + REAL query-client emitter + REAL
 * SessionExpiryBridge + REAL AuthContext. Only leaf I/O is mocked (fetch,
 * token-storage, AsyncStorage, toast). The piecewise unit tests each mock the
 * boundary between these modules; this asserts they're actually wired —
 * a token-bearing 401 from a real `apiRequest` → real interceptor → real
 * emitter → real bridge → real `expireSession` → auth state flips + toast.
 */
const { mockTokenStorage, mockFetch, mockToastError } = vi.hoisted(() => ({
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
  mockFetch: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("@/lib/push-token-registration", () => ({
  registerPushToken: vi.fn().mockResolvedValue(null),
}));
// Stable toast object so the bridge's effect doesn't re-subscribe each render.
const toastApi = { error: mockToastError, success: vi.fn(), info: vi.fn() };
vi.mock("@/context/ToastContext", () => ({ useToast: () => toastApi }));

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const fakeUser = { id: "1", username: "tester" };

function okJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function response401(code: string) {
  const body = { error: "rejected", code };
  const make = () => ({
    ok: false,
    status: 401,
    statusText: "",
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    clone: () => make(),
  });
  return make();
}

function AuthProbe() {
  const { isAuthenticated } = useAuthContext();
  return <div data-testid="authed">{String(isAuthenticated)}</div>;
}

describe("session-expiry integration (real useAuth + emitter + bridge)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a token-bearing session-code 401 from a real request logs out and toasts via the bridge", async () => {
    mockTokenStorage.get.mockResolvedValue("live-token");
    mockFetch.mockResolvedValueOnce(okJson(fakeUser)); // mount /me → authenticates

    render(
      <AuthProvider>
        <SessionExpiryBridge />
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authed").textContent).toBe("true"),
    );

    // A subsequent protected request comes back 401 with a session-token code.
    mockFetch.mockResolvedValueOnce(response401("TOKEN_REVOKED"));
    await act(async () => {
      await expect(apiRequest("GET", "/api/protected")).rejects.toThrow(
        /^401:/,
      );
    });

    // The real bridge ran the real expireSession (auth flips) and toasted.
    await waitFor(() =>
      expect(screen.getByTestId("authed").textContent).toBe("false"),
    );
    expect(mockToastError).toHaveBeenCalledWith(EXPIRED_MESSAGE);
    expect(mockTokenStorage.clear).toHaveBeenCalled();
  });

  it("a token-bearing 401 with a NON-session code (UNAUTHORIZED) does NOT log out or toast", async () => {
    mockTokenStorage.get.mockResolvedValue("live-token");
    mockFetch.mockResolvedValueOnce(okJson(fakeUser)); // mount /me → authenticates

    render(
      <AuthProvider>
        <SessionExpiryBridge />
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authed").textContent).toBe("true"),
    );

    // e.g. wrong confirmation password on an authenticated endpoint.
    mockFetch.mockResolvedValueOnce(response401("UNAUTHORIZED"));
    await act(async () => {
      await expect(
        apiRequest("DELETE", "/api/auth/account", { password: "wrong" }),
      ).rejects.toThrow(/^401:/);
    });

    expect(mockToastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("authed").textContent).toBe("true");
  });
});
