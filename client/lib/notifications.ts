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
  // selects the system default sound.
  await Notifications.setNotificationChannelAsync("coach-reminders", {
    name: "Coach Reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Request notification permissions. Returns true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}
