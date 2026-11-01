import { describe, it, expect, vi } from "vitest";
import express from "express";

// registerRoutes must only register handlers. Background work (the recipe
// search index build, the notification cron jobs) starts from server/index.ts,
// so a test or script that registers routes does not start it.
const { initSearchIndex, startNotificationScheduler } = vi.hoisted(() => ({
  initSearchIndex: vi.fn().mockResolvedValue(undefined),
  startNotificationScheduler: vi.fn(),
}));

vi.mock("../services/recipe-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/recipe-search")>()),
  initSearchIndex,
}));
vi.mock("../services/notification-scheduler", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../services/notification-scheduler")
  >()),
  startNotificationScheduler,
}));

describe("registerRoutes", () => {
  it("does not start the search index or the notification scheduler", async () => {
    const { registerRoutes } = await import("../routes");
    registerRoutes(express());

    expect(initSearchIndex).not.toHaveBeenCalled();
    expect(startNotificationScheduler).not.toHaveBeenCalled();
  });
});
