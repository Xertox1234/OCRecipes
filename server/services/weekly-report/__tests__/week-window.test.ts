import { describe, it, expect } from "vitest";
import { reportWeekFor } from "../week-window";

describe("reportWeekFor", () => {
  it("Saturday night in Los Angeles reports the previous Sunday–Saturday", () => {
    // 2026-11-15T05:00Z = Sat Nov 14, 21:00 PST
    const w = reportWeekFor(
      new Date("2026-11-15T05:00:00Z"),
      "America/Los_Angeles",
    );
    expect(w.weekStart).toBe("2026-11-01");
    expect(w.weekEnd).toBe("2026-11-07");
    expect(w.isReportDue).toBe(false);
  });

  it("Sunday 18:00 in Los Angeles reports the week that just ended", () => {
    // 2026-11-16T02:00Z = Sun Nov 15, 18:00 PST
    const w = reportWeekFor(
      new Date("2026-11-16T02:00:00Z"),
      "America/Los_Angeles",
    );
    expect(w.weekStart).toBe("2026-11-08");
    expect(w.weekEnd).toBe("2026-11-14");
    expect(w.isReportDue).toBe(true);
    expect(w.fromUtc.toISOString()).toBe("2026-11-08T08:00:00.000Z");
    expect(w.toUtc.toISOString()).toBe("2026-11-15T08:00:00.000Z");
  });

  it("a log at 23:30 local Saturday falls inside the window", () => {
    const w = reportWeekFor(
      new Date("2026-11-16T02:00:00Z"),
      "America/Los_Angeles",
    );
    const sat2330 = new Date("2026-11-15T07:30:00Z"); // Sat Nov 14, 23:30 PST
    expect(sat2330 >= w.fromUtc && sat2330 < w.toUtc).toBe(true);
    const sun0030 = new Date("2026-11-15T08:30:00Z"); // Sun Nov 15, 00:30 PST
    expect(sun0030 < w.toUtc).toBe(false);
  });

  it("Sunday 18:00 in Auckland ends on the local Saturday", () => {
    // 2026-11-15T05:00Z = Sun Nov 15, 18:00 NZDT (+13)
    const w = reportWeekFor(
      new Date("2026-11-15T05:00:00Z"),
      "Pacific/Auckland",
    );
    expect(w.weekStart).toBe("2026-11-08");
    expect(w.weekEnd).toBe("2026-11-14");
    expect(w.isReportDue).toBe(true);
    expect(w.toUtc.toISOString()).toBe("2026-11-14T11:00:00.000Z");
  });

  // Reliability audit 2026-11-19 M-rel-1: a restart or DB blip on the single
  // 18:00 tick lost the week's report. Generation is idempotent per (user,
  // week), so each later tick until 22:00 is a catch-up; none runs late at night.
  it.each([
    ["Sun 17:00", "2026-11-16T01:00:00Z", false],
    ["Sun 18:00", "2026-11-16T02:00:00Z", true],
    ["Sun 19:30", "2026-11-16T03:30:00Z", true],
    ["Sun 21:59", "2026-11-16T05:59:00Z", true],
    ["Sun 22:00", "2026-11-16T06:00:00Z", false],
    ["Mon 18:00", "2026-11-17T02:00:00Z", false],
  ])("Los Angeles %s (%s) → due %s", (_label, iso, due) => {
    expect(
      reportWeekFor(new Date(iso), "America/Los_Angeles").isReportDue,
    ).toBe(due);
  });
});
