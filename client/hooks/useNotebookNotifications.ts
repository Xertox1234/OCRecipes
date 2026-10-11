import { useCallback } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestNotificationPermission } from "@/lib/notifications";

const STORAGE_KEY = "COACH_NOTIFICATION_IDS";

async function getNotificationMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function setNotificationMap(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Cancel every OS-scheduled coach reminder, clear delivered ones from the tray
 * and drop the global id map. Reminders carry the signed-in user's journal
 * text, so every session-ending path runs this (via useAuth's
 * clearDurableLocalState — auth audit 2026-10-10 M2). Coach reminders are the
 * only local notifications this app schedules, so cancel-all is exact. Never
 * throws; returns false if any step failed so the durable-owner marker is not
 * advanced and the next auth resolution retries.
 */
export async function clearScheduledCoachReminders(): Promise<boolean> {
  let ok = true;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    ok = false;
  }
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    ok = false;
  }
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    ok = false;
  }
  return ok;
}

export function useNotebookNotifications() {
  const scheduleCommitmentReminder = useCallback(
    async (
      entryId: number,
      content: string,
      followUpDate: string,
    ): Promise<void> => {
      const granted = await requestNotificationPermission();
      if (!granted) return;

      const map = await getNotificationMap();
      const existing = map[String(entryId)];
      if (existing) {
        await Notifications.cancelScheduledNotificationAsync(existing).catch(
          () => {},
        );
      }

      const [year, month, day] = followUpDate.split("-").map(Number);
      const fireDate = new Date(year, month - 1, day, 9, 0, 0);
      if (fireDate <= new Date()) return;

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Coach reminder",
          body: content.slice(0, 100),
          // `url` is what client/navigation/linking.ts's getInitialURL/
          // subscribe resolve a tap through. `entryId` stays alongside it,
          // matching the server-driven push payload
          // (server/services/notification-scheduler.ts, the primary delivery
          // path; this client-side scheduler is only a fallback), which sends
          // the same `{ entryId, url }` shape. linking.ts's fallback
          // (constructing this URL from a bare entryId) still serves
          // notifications delivered before `url` existed.
          data: { entryId, url: `ocrecipes://notebook-entry/${entryId}` },
          ...(Platform.OS === "android"
            ? { channelId: "coach-reminders" }
            : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
        },
      });

      map[String(entryId)] = id;
      await setNotificationMap(map);
    },
    [],
  );

  const cancelCommitmentReminder = useCallback(
    async (entryId: number): Promise<void> => {
      const map = await getNotificationMap();
      const id = map[String(entryId)];
      if (id) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(
          () => {},
        );
        const updated = { ...map };
        delete updated[String(entryId)];
        await setNotificationMap(updated);
      }
    },
    [],
  );

  const cancelStaleReminders = useCallback(
    async (activeEntryIds: number[]): Promise<void> => {
      const map = await getNotificationMap();
      const activeSet = new Set(activeEntryIds.map(String));
      const toCancel = Object.keys(map).filter((id) => !activeSet.has(id));
      await Promise.all(
        toCancel.map((id) =>
          Notifications.cancelScheduledNotificationAsync(map[id]).catch(
            () => {},
          ),
        ),
      );
      if (toCancel.length > 0) {
        const updated = { ...map };
        toCancel.forEach((id) => delete updated[id]);
        await setNotificationMap(updated);
      }
    },
    [],
  );

  return {
    scheduleCommitmentReminder,
    cancelCommitmentReminder,
    cancelStaleReminders,
  };
}
