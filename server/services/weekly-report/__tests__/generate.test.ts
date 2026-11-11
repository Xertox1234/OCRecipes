import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../../storage";
import { notify } from "../../notifications/notify";
import { writeWeeklyReport } from "../writer";
import { createMockWeeklyFacts } from "../../../__tests__/factories";
import { isAiSharingAllowedFor } from "../../../lib/ai-sharing-gate";
import {
  generateWeeklyReportForUser,
  sendDueWeeklyReportPushes,
} from "../generate";

vi.mock("../../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    getWeeklyReportSettings: vi.fn(),
    weeklyReportExists: vi.fn(),
    getWeeklyReportInputs: vi.fn(),
    getRecentWeeklyFacts: vi.fn(),
    getFeatureUsage: vi.fn(),
    insertWeeklyReport: vi.fn(),
    hasReminderSince: vi.fn(),
    getDuePushes: vi.fn(),
    claimWeeklyReportDelivery: vi.fn(),
    releaseWeeklyReportDelivery: vi.fn(),
  },
}));
vi.mock("../../notifications/notify", () => ({ notify: vi.fn() }));
vi.mock("../writer", () => ({ writeWeeklyReport: vi.fn() }));
vi.mock("../../../lib/ai-sharing-gate", () => ({
  isAiSharingAllowedFor: vi.fn(),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  toError: (e: unknown) => e,
}));

const s = vi.mocked(storage);
// Sun 2026-11-15 18:00 in Los Angeles.
const NOW = new Date("2026-11-16T02:00:00Z");
const TZ = "America/Los_Angeles";

const content = {
  headline: "You showed up 3 of 7 days this week.",
  wins: [],
  watch: [],
  next: null,
  fromLogged: null,
  trendLine: null,
};

const loggedDay = (date: string) => ({
  loggedAt: new Date(`${date}T20:00:00Z`),
  mealType: null,
  calories: 900,
  protein: 50,
  carbs: null,
});

function inputs(logged = true) {
  return {
    goals: { calories: 2000, protein: 120, carbs: null },
    logs: logged
      ? ["2026-11-09", "2026-11-10", "2026-11-11"].map(loggedDay)
      : [],
    recipes: [],
    coachMessages: [],
  };
}

const emptyWeek = (weekStart: string) =>
  createMockWeeklyFacts({ weekStart, mealsLogged: 0, tipIds: [] });

beforeEach(() => {
  vi.resetAllMocks();
  s.getEffectiveTierForUser.mockResolvedValue("premium");
  s.getWeeklyReportSettings.mockResolvedValue({
    reportEnabled: true,
    pushEnabled: true,
  });
  s.weeklyReportExists.mockResolvedValue(false);
  s.getWeeklyReportInputs.mockResolvedValue(inputs());
  s.getRecentWeeklyFacts.mockResolvedValue([]);
  s.getFeatureUsage.mockResolvedValue({
    barcode: false,
    photo: false,
    import: false,
    pantry: false,
    mealPlan: false,
    voice: false,
    cookbooks: false,
  });
  s.insertWeeklyReport.mockResolvedValue({ id: 41 });
  s.hasReminderSince.mockResolvedValue(false);
  vi.mocked(writeWeeklyReport).mockResolvedValue({ content, source: "ai" });
  vi.mocked(notify).mockResolvedValue({ pushDelivered: true });
  vi.mocked(isAiSharingAllowedFor).mockResolvedValue(true);
});

const inserted = () => s.insertWeeklyReport.mock.calls[0][1];

describe("generateWeeklyReportForUser", () => {
  it("skips a free user without writing anything", async () => {
    s.getEffectiveTierForUser.mockResolvedValue("free");
    expect(await generateWeeklyReportForUser("u1", NOW, TZ)).toBe(
      "skipped-not-pro",
    );
    expect(writeWeeklyReport).not.toHaveBeenCalled();
    expect(s.insertWeeklyReport).not.toHaveBeenCalled();
  });

  it("skips when the user turned the report off", async () => {
    s.getWeeklyReportSettings.mockResolvedValue({
      reportEnabled: false,
      pushEnabled: true,
    });
    expect(await generateWeeklyReportForUser("u1", NOW, TZ)).toBe(
      "skipped-disabled",
    );
    expect(writeWeeklyReport).not.toHaveBeenCalled();
  });

  it("an existing report for the week makes no second AI call", async () => {
    s.weeklyReportExists.mockResolvedValue(true);
    expect(await generateWeeklyReportForUser("u1", NOW, TZ)).toBe("exists");
    expect(writeWeeklyReport).not.toHaveBeenCalled();
  });

  it("stores the Sunday–Saturday week with the push due now", async () => {
    expect(await generateWeeklyReportForUser("u1", NOW, TZ)).toBe("created");
    const row = inserted();
    expect(row.weekStart).toBe("2026-11-08");
    expect(row.weekEnd).toBe("2026-11-14");
    expect(row.facts.daysActive).toBe(3);
    expect(row.facts.tipIds).toHaveLength(1);
    expect(row.source).toBe("ai");
    expect(row.pushDueAt).toEqual(NOW);
    expect(s.getWeeklyReportInputs).toHaveBeenCalledWith(
      "u1",
      new Date("2026-11-08T08:00:00Z"),
      new Date("2026-11-15T08:00:00Z"),
    );
  });

  it("asks the writer for AI text only when the user allows AI sharing", async () => {
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(vi.mocked(writeWeeklyReport).mock.calls[0][1]).toEqual({
      aiAllowed: true,
    });
    vi.mocked(isAiSharingAllowedFor).mockResolvedValue(false);
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(isAiSharingAllowedFor).toHaveBeenCalledWith("u1");
    expect(vi.mocked(writeWeeklyReport).mock.calls[1][1]).toEqual({
      aiAllowed: false,
    });
  });

  it("a lost insert race reports exists", async () => {
    s.insertWeeklyReport.mockResolvedValue(null);
    expect(await generateWeeklyReportForUser("u1", NOW, TZ)).toBe("exists");
  });

  it("push turned off → no push is scheduled (popup instead)", async () => {
    s.getWeeklyReportSettings.mockResolvedValue({
      reportEnabled: true,
      pushEnabled: false,
    });
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(inserted().pushDueAt).toBeNull();
  });

  it("a third empty week in a row schedules no push", async () => {
    s.getWeeklyReportInputs.mockResolvedValue(inputs(false));
    s.getRecentWeeklyFacts.mockResolvedValue([
      emptyWeek("2026-11-01"),
      emptyWeek("2026-10-25"),
    ]);
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(inserted().pushDueAt).toBeNull();
  });

  it("a second empty week still pushes", async () => {
    s.getWeeklyReportInputs.mockResolvedValue(inputs(false));
    s.getRecentWeeklyFacts.mockResolvedValue([emptyWeek("2026-11-01")]);
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(inserted().pushDueAt).toEqual(NOW);
  });

  it("a commitment push earlier that local day holds the push to 09:00 next morning", async () => {
    s.hasReminderSince.mockResolvedValue(true);
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(s.hasReminderSince).toHaveBeenCalledWith(
      "u1",
      "commitment",
      new Date("2026-11-15T08:00:00Z"), // local midnight Sun Nov 15
    );
    // Mon Nov 16 09:00 PST
    expect(inserted().pushDueAt).toEqual(new Date("2026-11-16T17:00:00Z"));
  });

  it("passes the safety signal from the week's coach messages", async () => {
    s.getWeeklyReportInputs.mockResolvedValue({
      ...inputs(),
      coachMessages: ["I want to purge"],
    });
    await generateWeeklyReportForUser("u1", NOW, TZ);
    expect(inserted().facts.safetySignal).toBe(true);
  });
});

describe("sendDueWeeklyReportPushes", () => {
  it("claims before sending and sends once per report", async () => {
    s.getDuePushes.mockResolvedValue([
      { userId: "u1", id: 41, headline: "Your headline" },
    ]);
    s.claimWeeklyReportDelivery
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await sendDueWeeklyReportPushes(NOW)).toBe(1);
    expect(await sendDueWeeklyReportPushes(NOW)).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("u1", "weekly-report", {
      title: "Your week is ready",
      body: "Your headline",
      data: {
        url: "ocrecipes://weekly-report/41",
        type: "weekly-report",
        reportId: 41,
      },
    });
  });

  it("a push that reaches no device releases the claim for the popup", async () => {
    s.getDuePushes.mockResolvedValue([{ userId: "u1", id: 41, headline: "h" }]);
    s.claimWeeklyReportDelivery.mockResolvedValue(true);
    vi.mocked(notify).mockResolvedValue({ pushDelivered: false });
    expect(await sendDueWeeklyReportPushes(NOW)).toBe(0);
    expect(s.releaseWeeklyReportDelivery).toHaveBeenCalledWith("u1", 41);
  });

  it("a push that throws releases the claim and carries on", async () => {
    s.getDuePushes.mockResolvedValue([
      { userId: "u1", id: 41, headline: "h" },
      { userId: "u2", id: 42, headline: "h" },
    ]);
    s.claimWeeklyReportDelivery.mockResolvedValue(true);
    vi.mocked(notify)
      .mockImplementationOnce(async () => {
        throw new Error("expo down");
      })
      .mockResolvedValueOnce({ pushDelivered: true });
    expect(await sendDueWeeklyReportPushes(NOW)).toBe(1);
    expect(s.releaseWeeklyReportDelivery).toHaveBeenCalledWith("u1", 41);
  });
});
