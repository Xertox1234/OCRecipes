import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { buildWeeklyReportBlock } from "../weekly-report-card";
import { readWeeklyReportRequest } from "../day-progress-request";
import { coachBlockSchema } from "@shared/schemas/coach-blocks";
import {
  createMockWeeklyFacts,
  createMockWeeklyReport,
  createMockWeeklyReportContent,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: { getWeeklyReport: vi.fn() },
}));

describe("readWeeklyReportRequest", () => {
  it("reads the report id, whatever else the model added", () => {
    expect(
      readWeeklyReportRequest({ type: "weekly_report", reportId: 3 }),
    ).toBe(3);
    expect(
      readWeeklyReportRequest({
        type: "weekly_report",
        reportId: 3,
        headline: "made up",
      }),
    ).toBe(3);
  });

  it("is not a request without one positive id", () => {
    for (const raw of [
      { type: "weekly_report" },
      { type: "weekly_report", reportId: 0 },
      { type: "weekly_report", reportId: 1.5 },
      { type: "weekly_report", reportId: "3" },
      { type: "weekly_report", reportId: 1e12 },
      { type: "week_progress", reportId: 3 },
      null,
    ]) {
      expect(readWeeklyReportRequest(raw)).toBeUndefined();
    }
  });
});

describe("buildWeeklyReportBlock", () => {
  beforeEach(() => vi.mocked(storage.getWeeklyReport).mockReset());

  it("builds the card from the stored report, read for this user", async () => {
    vi.mocked(storage.getWeeklyReport).mockResolvedValue(
      createMockWeeklyReport({
        id: 9,
        facts: createMockWeeklyFacts({
          daysActive: 5,
          mealsLogged: 13,
          proteinDaysMet: 3,
        }),
        content: createMockWeeklyReportContent({
          headline: "Five days logged",
        }),
      }),
    );
    const block = await buildWeeklyReportBlock(9, "user-1");
    expect(storage.getWeeklyReport).toHaveBeenCalledWith("user-1", 9);
    expect(block).toEqual({
      type: "weekly_report",
      reportId: 9,
      weekStart: "2026-11-01",
      weekEnd: "2026-11-07",
      headline: "Five days logged",
      daysActive: 5,
      mealsLogged: 13,
      proteinDaysMet: 3,
    });
    expect(coachBlockSchema.safeParse(block).success).toBe(true);
  });

  it("keeps a week with no protein goal as null, not zero", async () => {
    vi.mocked(storage.getWeeklyReport).mockResolvedValue(
      createMockWeeklyReport({
        facts: createMockWeeklyFacts({ proteinDaysMet: null }),
      }),
    );
    const block = await buildWeeklyReportBlock(1, "user-1");
    expect(block.proteinDaysMet).toBeNull();
  });

  it("leaves out the protein goal days of a week the report guarded", async () => {
    for (const guard of [{ lowCalorieGuard: true }, { safetySignal: true }]) {
      vi.mocked(storage.getWeeklyReport).mockResolvedValueOnce(
        createMockWeeklyReport({
          facts: createMockWeeklyFacts({ proteinDaysMet: 6, ...guard }),
        }),
      );
      const block = await buildWeeklyReportBlock(1, "user-1");
      expect(block.proteinDaysMet).toBeNull();
    }
  });

  it("throws for a report that is not this user's (or does not parse)", async () => {
    vi.mocked(storage.getWeeklyReport).mockResolvedValue(null);
    await expect(buildWeeklyReportBlock(4, "user-1")).rejects.toThrow(
      /report 4/,
    );
  });
});
