/**
 * Generic notification utilities.
 * Platform-agnostic helpers for permission management and channel setup.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Create the Android notification channel (no-op on iOS). Call once at app startup. */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("fasting", {
    name: "Fasting Timer",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
  await Notifications.setNotificationChannelAsync("coach-reminders", {
    name: "Coach Reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
}

/** Request notification permissions. Returns true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}
