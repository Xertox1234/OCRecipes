import { vi } from "vitest";

/**
 * Global mock for @react-native-community/netinfo.
 *
 * Registered as a resolve.alias in vitest.config.ts so that any test-suite
 * file that imports query-client.ts (which calls onlineManager.setEventListener
 * at module load) does not trigger a real NetInfo native module.
 *
 * IMPORTANT: addEventListener is a no-op stub (does NOT invoke the callback).
 * Real NetInfo fires immediately with the current state; if this mock did the
 * same, onlineManager would receive a state call at import time and could flip
 * the TanStack Query onlineManager offline across all workers — pausing every
 * query in the test suite.
 *
 * Tests that need to exercise NetInfo-driven behaviour (e.g. useNetworkStatus)
 * override this mock locally via `vi.mock('@react-native-community/netinfo')`.
 */

const addEventListener = vi.fn(() => {
  // Returns an unsubscribe function, per the real NetInfo contract.
  return vi.fn();
});

const fetch = vi.fn(() =>
  Promise.resolve({
    isConnected: true,
    isInternetReachable: true,
    type: "wifi",
    details: null,
  }),
);

export default {
  addEventListener,
  fetch,
};
