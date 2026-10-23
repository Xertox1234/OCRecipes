/**
 * Generic notification utilities.
 * Platform-agnostic helpers for permission management and channel setup.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Create the Android notification channel (no-op on iOS). Call once at app startup. */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  // No `sound` key: a string value names a CUSTOM sound file bundled via the
  // expo-notifications config plugin — "default" is not one, so it logged a
  // console error on every Android launch (whose LogBox toast then covered
  // the login screen's bottom controls in dev builds). Omitting the key
  // selects the system default sound. Note: Android channels are immutable
  // after creation — edits here never retouch an already-provisioned
  // channel; shipping a real custom sound later needs a NEW channel id.
  await Notifications.setNotificationChannelAsync("coach-reminders", {
    name: "Coach Reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Keep notifications that arrive while the app is open hidden: no banner, no
 * list entry, no sound, no badge change (owner ruling, SDK 58 upgrade spec §9
 * ruling 2). Set explicitly so a library default can't change it. Tapping a
 * notification from the background is untouched — that goes through the
 * response listener in client/navigation/linking.ts. Call once at module
 * scope, before any notification can arrive.
 */
export function installForegroundNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

/** Request notification permissions. Returns true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}
