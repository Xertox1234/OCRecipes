import { useCallback } from "react";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

export function useNotebookNotifications() {
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  }, []);

  const scheduleCommitmentReminder = useCallback(
    async (
      entryId: number,
      content: string,
      followUpDate: string,
    ): Promise<void> => {
      const granted = await requestPermission();
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
          data: { entryId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
        },
      });

      map[String(entryId)] = id;
      await setNotificationMap(map);
    },
    [requestPermission],
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
