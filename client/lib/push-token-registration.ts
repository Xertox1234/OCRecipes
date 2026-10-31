/**
 * Expo push token registration.
 *
 * Obtains the Expo push token for the current device and registers it with the
 * OCRecipes server so that server-driven push notifications can be delivered.
 *
 * Requires:
 *   - EXPO_PUBLIC_PROJECT_ID env var set to the Expo project ID (found in
 *     app.json › expo.extra.eas.projectId or the EAS dashboard).
 *   - expo-notifications permission granted.
 *
 * Graceful degradation: if EXPO_PUBLIC_PROJECT_ID is not set, or if permission
 * is denied, the function returns without throwing. Local notification fallback
 * (useNotebookNotifications) continues to work regardless.
 *
 * Token rotation: this function runs on every sign-in (prompting for
 * permission), again without prompting whenever a persisted session is
 * restored on launch, and from subscribePushTokenRotation() while signed in,
 * so a token the platform rotates reaches the server via the upsert endpoint.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest } from "./query-client";

const PROJECT_ID = process.env.EXPO_PUBLIC_PROJECT_ID;

/**
 * Register the device's Expo push token with the server.
 * Fire-and-forget — call after a successful login and do not await in hot paths.
 *
 * @param options.prompt Ask for notification permission when it is not yet
 *   granted (default true, for sign-in). Pass false for background upkeep
 *   (session restore, token rotation) so it never re-prompts the user.
 * @returns The registered token string, or null if registration was skipped.
 */
export async function registerPushToken(
  options: { prompt?: boolean } = {},
): Promise<string | null> {
  const prompt = options.prompt ?? true;
  if (!PROJECT_ID) {
    // No project ID configured — skip silently. Local notifications still work.
    return null;
  }

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      if (!prompt) return null;
      const { status: requested } =
        await Notifications.requestPermissionsAsync();
      status = requested;
    }
    if (status !== "granted") return null;

    const pushToken = await Notifications.getExpoPushTokenAsync({
      projectId: PROJECT_ID,
    });

    const platform = Platform.OS === "ios" ? "ios" : "android";

    await apiRequest("POST", "/api/push-tokens", {
      token: pushToken.data,
      platform,
    });

    return pushToken.data;
  } catch {
    // Non-fatal: local notifications are the fallback.
    return null;
  }
}

/**
 * Re-register (without prompting) whenever the platform rotates this device's
 * push token while the app runs — Expo: "Push tokens can occasionally change
 * while an application is running". Call while signed in; the returned
 * function stops listening and must run before sign-out unregisters the token.
 */
export function subscribePushTokenRotation(): () => void {
  if (!PROJECT_ID) return () => {};
  const subscription = Notifications.addPushTokenListener(() => {
    void registerPushToken({ prompt: false });
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    subscription.remove();
  };
}

/**
 * Remove this device's push token from the signed-in account (auth audit H2).
 * An Expo push token belongs to the app install, so without this the previous
 * user's reminders keep reaching a signed-out phone. Call from logout() BEFORE
 * the logout POST revokes the session token this DELETE needs. Never prompts
 * for permission and never throws — sign-out must always continue.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!PROJECT_ID) return;
  // Capped so a slow or offline network can never stall sign-out. Once the
  // cap fires the DELETE must never be sent: apiRequest attaches whatever
  // session token is stored at send time, which after a new sign-in is the
  // NEXT user's, and the DELETE would remove their row instead.
  const cap = { timedOut: false };
  await Promise.race([
    deleteThisDevicesToken(PROJECT_ID, cap),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        cap.timedOut = true;
        resolve();
      }, UNREGISTER_TIMEOUT_MS),
    ),
  ]);
}

const UNREGISTER_TIMEOUT_MS = 3000;

async function deleteThisDevicesToken(
  projectId: string,
  cap: { timedOut: boolean },
): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
    if (cap.timedOut) return;
    await apiRequest("DELETE", "/api/push-tokens", { token: pushToken.data });
  } catch {
    // Non-fatal: registering on the next sign-in moves the token anyway.
  }
}
