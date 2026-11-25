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

const mockPushRegistered = vi.fn(() => false);
vi.mock("@/lib/push-token-registration", () => ({
  isPushRegistered: () => mockPushRegistered(),
}));

const mockCancel = vi.fn();
const mockScheduleNotificationAsync = vi.fn();
const mockCancelAll = vi.fn();
const mockDismissAll = vi.fn();
vi.mock("expo-notifications", () => ({
  scheduleNotificationAsync: (...args: unknown[]) =>
    mockScheduleNotificationAsync(...args),
  cancelAllScheduledNotificationsAsync: () => mockCancelAll(),
  dismissAllNotificationsAsync: () => mockDismissAll(),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

describe("useNotebookNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockRequestNotificationPermission.mockResolvedValue(true);
    mockScheduleNotificationAsync.mockResolvedValue("scheduled-id");
    mockPushRegistered.mockReturnValue(false);
    mockCancel.mockResolvedValue(undefined);
  });

  describe("with the id map stored", () => {
    let stored: string | null;
    const map = () => JSON.parse(stored ?? "{}") as Record<string, string>;
    beforeEach(() => {
      stored = null;
      mockAsyncStorage.getItem.mockImplementation(async () => stored);
      mockAsyncStorage.setItem.mockImplementation(
        async (_key: string, value: string) => {
          stored = value;
        },
      );
    });

    // L61: cleanup runs on every refetch, so it overlaps a save.
    it("keeps a reminder scheduled while stale ones are being cancelled", async () => {
      stored = JSON.stringify({ "1": "old" });
      let finishCancel = () => {};
      mockCancel.mockReturnValue(
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
      );
      const { result } = renderHook(() => useNotebookNotifications());
      await act(async () => {
        const cleanup = result.current.cancelStaleReminders([42]);
        const save = result.current.scheduleCommitmentReminder(
          42,
          "Walk",
          "2099-01-04",
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        finishCancel();
        await Promise.all([cleanup, save]);
      });
      expect(map()).toEqual({ "42": "scheduled-id" });
    });

    it("a failed step does not block the next one", async () => {
      mockScheduleNotificationAsync.mockRejectedValueOnce(new Error("native"));
      const { result } = renderHook(() => useNotebookNotifications());
      await act(async () => {
        await expect(
          result.current.scheduleCommitmentReminder(1, "Walk", "2099-01-04"),
        ).rejects.toThrow("native");
        await result.current.scheduleCommitmentReminder(2, "Run", "2099-01-04");
      });
      expect(map()).toEqual({ "2": "scheduled-id" });
    });

    // M12: the server's push is the reminder on a phone registered for it.
    it("schedules nothing on a phone the server pushes to, and drops the old one", async () => {
      stored = JSON.stringify({ "42": "old" });
      mockPushRegistered.mockReturnValue(true);
      const { result } = renderHook(() => useNotebookNotifications());
      await act(() =>
        result.current.scheduleCommitmentReminder(42, "Walk", "2099-01-04"),
      );
      expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
      expect(mockCancel).toHaveBeenCalledWith("old");
      expect(map()).toEqual({});
    });

    it("drops the cancelled id when the new date has passed", async () => {
      stored = JSON.stringify({ "42": "old" });
      const { result } = renderHook(() => useNotebookNotifications());
      await act(() =>
        result.current.scheduleCommitmentReminder(42, "Walk", "2020-01-04"),
      );
      expect(map()).toEqual({});
    });
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
