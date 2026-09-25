// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotebookNotifications } from "../useNotebookNotifications";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

const mockRequestNotificationPermission = vi.fn();
vi.mock("@/lib/notifications", () => ({
  requestNotificationPermission: () => mockRequestNotificationPermission(),
}));

const mockScheduleNotificationAsync = vi.fn();
vi.mock("expo-notifications", () => ({
  scheduleNotificationAsync: (...args: unknown[]) =>
    mockScheduleNotificationAsync(...args),
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
  // via `data.url`, falling back to a legacy `data.entryId`-only payload only
  // for reminders scheduled by an older build. New reminders must carry the
  // full-prefix URL so a tap routes without relying on that fallback.
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
