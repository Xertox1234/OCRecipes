// Inert stub for expo-notifications, registered as a resolve.alias in
// vitest.config.mts.
//
// The real package's import chain (expo-notifications -> expo ->
// expo/src/winter/runtime.ts -> expo/src/async-require/setup.ts) runs a
// dev-only `require("./setupFastRefresh")` that Node's native require can't
// resolve (the sibling is a `.ts` file), so ANY module that transitively
// imports the package fails at import with `Cannot find module
// './setupFastRefresh'` — @/lib/push-token-registration, and through it
// @/hooks/useAuth -> AuthContext -> PremiumContext -> useHistoryData.
//
// Covers only the API the client calls. Permissions resolve "denied", so
// registerPushToken() and requestNotificationPermission() are quiet no-ops (no
// token, no network). A test that asserts on notification calls keeps using
// its own `vi.mock("expo-notifications", factory)` — see
// client/hooks/__tests__/useNotebookNotifications.test.ts.
export const AndroidImportance = { DEFAULT: 3 } as const;

export const SchedulableTriggerInputTypes = { DATE: "date" } as const;

export const getPermissionsAsync = () => Promise.resolve({ status: "denied" });
export const requestPermissionsAsync = () =>
  Promise.resolve({ status: "denied" });
export const getExpoPushTokenAsync = () => Promise.resolve({ data: "" });
export const setNotificationChannelAsync = () => Promise.resolve(null);
export const scheduleNotificationAsync = () => Promise.resolve("");
export const cancelScheduledNotificationAsync = () => Promise.resolve();
export const getLastNotificationResponse = () => null;
export const clearLastNotificationResponse = () => {};
export const addNotificationResponseReceivedListener = () => ({
  remove: () => {},
});
