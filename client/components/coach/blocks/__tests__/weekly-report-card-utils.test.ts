import { describe, it, expect } from "vitest";
import { reportSpoken, reportStats } from "../weekly-report-card-utils";
import type { WeeklyReportBlock } from "@shared/schemas/coach-blocks";

const block: WeeklyReportBlock = {
  type: "weekly_report",
  reportId: 12,
  weekStart: "2026-11-15",
  weekEnd: "2026-11-21",
  headline: "Five days logged",
  daysActive: 5,
  mealsLogged: 14,
  proteinDaysMet: 4,
};

describe("reportStats", () => {
  it("names the days logged, the meals and the protein goal days", () => {
    expect(reportStats(block)).toEqual([
      "5 of 7 days logged",
      "14 meals",
      "Protein goal met 4 days",
    ]);
  });

  it("says one, not ones, and leaves out a week with no protein goal", () => {
    expect(
      reportStats({
        ...block,
        daysActive: 1,
        mealsLogged: 1,
        proteinDaysMet: null,
      }),
    ).toEqual(["1 of 7 days logged", "1 meal"]);
    expect(reportStats({ ...block, proteinDaysMet: 1 })[2]).toBe(
      "Protein goal met 1 day",
    );
  });
});

describe("reportSpoken", () => {
  it("speaks the week, the headline and the counts", () => {
    expect(reportSpoken(block)).toBe(
      "Your week, Nov 15–21. Five days logged. 5 of 7 days logged. 14 meals. Protein goal met 4 days",
    );
  });

  it("does not double a full stop the headline already has", () => {
    expect(reportSpoken({ ...block, headline: "A steady week." })).toContain(
      "A steady week. 5 of 7",
    );
    expect(reportSpoken({ ...block, headline: "Nice work!" })).toContain(
      "Nice work! 5 of 7",
    );
  });
});
