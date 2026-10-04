// In-memory stub for expo-secure-store, registered as a resolve.alias in
// vitest.config.mts.
//
// The real package calls requireNativeModule("ExpoSecureStore") at import, which
// throws under Node, so ANY module that transitively imports
// @/lib/token-storage (useAuth, query-client, most screens) would fail to load.
//
// Covers only the API the client calls. Values live in a per-worker Map, so a
// test that needs to inspect or fail the store keeps using its own
// `vi.mock("expo-secure-store", factory)` — see
// client/lib/__tests__/token-storage.test.ts.
const store = new Map<string, string>();

export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 3;

export function getItemAsync(key: string): Promise<string | null> {
  return Promise.resolve(store.get(key) ?? null);
}

export function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
  return Promise.resolve();
}

export function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
  return Promise.resolve();
}
