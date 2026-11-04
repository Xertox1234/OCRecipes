import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest } from "@/lib/query-client";

/** Returns the device's IANA timezone string, e.g. "America/Los_Angeles". */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const TIMEZONE_SENT_KEY_PREFIX = "@ocrecipes_timezone_sent:";

/**
 * Tell the server the phone's IANA timezone so daily quotas reset at local
 * midnight. The server stores it once (write-once), so this sends once per
 * user per install: a local marker, set only after a successful send, stops
 * later launches from re-sending. Never throws — a failure (offline, 5xx,
 * unreadable storage) leaves the marker unset and the next launch retries.
 */
export async function sendDeviceTimezoneOnce(userId: string): Promise<void> {
  try {
    const key = `${TIMEZONE_SENT_KEY_PREFIX}${userId}`;
    if (await AsyncStorage.getItem(key)) return;
    await apiRequest("PUT", "/api/auth/profile", {
      timezone: getDeviceTimezone(),
    });
    await AsyncStorage.setItem(key, "1");
  } catch {
    // Silent by design; retried at the next launch.
  }
}
