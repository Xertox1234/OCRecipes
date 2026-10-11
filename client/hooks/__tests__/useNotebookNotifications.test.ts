// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  clearScheduledCoachReminders,
  useNotebookNotifications,
} from "../useNotebookNotifications";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

const mockRequestNotificationPermission = vi.fn();
vi.mock("@/lib/notifications", () => ({
  requestNotificationPermission: () => mockRequestNotificationPermission(),
}));

const mockScheduleNotificationAsync = vi.fn();
const mockCancelAll = vi.fn();
const mockDismissAll = vi.fn();
vi.mock("expo-notifications", () => ({
  scheduleNotificationAsync: (...args: unknown[]) =>
    mockScheduleNotificationAsync(...args),
  cancelAllScheduledNotificationsAsync: () => mockCancelAll(),
  dismissAllNotificationsAsync: () => mockDismissAll(),
  cancelScheduledNotificationAsync: vi.fn(),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

describe("useNotebookNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockRequestNotificationPermission.mockResolvedValue(true);
    mockScheduleNotificationAsync.mockResolvedValue("scheduled-id");
  });

  // AC: "Reminder payloads carry a URL" — the `linking` config's
  // getInitialURL/subscribe (client/navigation/linking.ts) resolves a tap
  // via `data.url`, falling back to an `entryId`-only payload. That fallback
  // is permanent, not legacy-only: the server's push scheduler (the primary
  // delivery path) still sends `data: { entryId }`. Reminders this client
  // schedules must carry the full-prefix URL so they don't depend on it.
  it("schedules a reminder whose content.data carries a full-prefix url alongside entryId", async () => {
    const { result } = renderHook(() => useNotebookNotifications());

    // followUpDate must be in the future — scheduleCommitmentReminder
    // early-returns when the computed fire date has already passed.
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const followUpDate = future.toISOString().slice(0, 10);

    await act(async () => {
      await result.current.scheduleCommitmentReminder(
        42,
        "Log your breakfast",
        followUpDate,
      );
    });

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [{ content }] = mockScheduleNotificationAsync.mock.calls[0] as [
      { content: { data: Record<string, unknown> } },
    ];
    expect(content.data).toMatchObject({
      entryId: 42,
      url: "ocrecipes://notebook-entry/42",
    });
  });
});

// Auth audit 2026-10-10 M2: reminders carry the signed-in user's journal text,
// so every session-ending path must cancel them and drop the global id map.
describe("clearScheduledCoachReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancelAll.mockResolvedValue(undefined);
    mockDismissAll.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  it("cancels scheduled reminders, clears the tray and drops the id map", async () => {
    await expect(clearScheduledCoachReminders()).resolves.toBe(true);
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
      "COACH_NOTIFICATION_IDS",
    );
  });

  it("reports false (never throws) and still drops the map when cancelling fails", async () => {
    mockCancelAll.mockRejectedValue(new Error("native"));
    await expect(clearScheduledCoachReminders()).resolves.toBe(false);
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
      "COACH_NOTIFICATION_IDS",
    );
  });

  it("reports false when the map cannot be removed", async () => {
    mockAsyncStorage.removeItem.mockRejectedValue(new Error("disk"));
    await expect(clearScheduledCoachReminders()).resolves.toBe(false);
  });
});
