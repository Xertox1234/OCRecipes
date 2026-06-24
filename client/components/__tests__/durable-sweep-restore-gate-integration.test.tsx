// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { AuthProvider, useAuthContext } from "@/context/AuthContext";
import {
  queryClient,
  asyncStoragePersister,
  markQueryCacheRestored,
} from "@/lib/query-client";

/**
 * End-to-end wiring test for the durable-sweep restore gate.
 *
 * The no-token cold-start teardown (clearDurableLocalState → whenQueryCacheRestored)
 * blocks the auth-state flip until the persisted query cache finishes restoring.
 * In production that release comes ONLY from PersistQueryClientProvider's
 * `onSuccess`/`onError` props firing `markQueryCacheRestored` (see App.tsx). Every
 * other test mocks the gate or fires it manually, so the provider→gate wiring
 * itself is otherwise uncovered: delete those two props in App.tsx and the unit
 * tests still pass while production wedges on the 5s safety timeout every cold
 * start. This test wires the REAL provider exactly as App.tsx does and lets ONLY
 * its restore release the gate — if the wiring is wrong, the auth flip never
 * arrives within the default waitFor and this fails loudly. MUST stay in sync with
 * App.tsx's PersistQueryClientProvider props.
 *
 * Single test by design: the restore gate is a module-level one-shot promise, so a
 * sibling test that released it would let this one pass without the provider doing
 * the work.
 */
const { mockTokenStorage } = vi.hoisted(() => ({
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));
// Empty restore: every key reads null, so persistQueryClientRestore resolves with
// no persisted client and fires onSuccess (the fresh-install cold-start shape).
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

function Probe() {
  const { isAuthenticated, isLoading } = useAuthContext();
  return (
    <div data-testid="state">
      {isLoading ? "loading" : String(isAuthenticated)}
    </div>
  );
}

describe("durable-sweep restore-gate wiring (real PersistQueryClientProvider)", () => {
  it("reaches unauthenticated on the no-token cold start, with the gate released ONLY by the real provider restore (no manual mark, no wedge)", async () => {
    mockTokenStorage.get.mockResolvedValue(null); // no-token cold-start sweep path

    render(
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: asyncStoragePersister,
          maxAge: 24 * 60 * 60 * 1000,
        }}
        onSuccess={markQueryCacheRestored}
        onError={markQueryCacheRestored}
      >
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </PersistQueryClientProvider>,
    );

    // checkAuth's no-token branch awaits whenQueryCacheRestored() inside the sweep
    // before flipping auth. Nothing here calls markQueryCacheRestored manually, so
    // the ONLY thing that can release the gate within the default ~1s waitFor is
    // the provider's real restore → onSuccess. If that wiring were broken, the gate
    // would resolve only via the 5s safety timeout and this assertion would fail.
    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("false"),
    );
  });
});
