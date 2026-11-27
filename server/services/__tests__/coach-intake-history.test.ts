import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeToolCall, getToolDefinitions } from "../coach-tools";
import { storage } from "../../storage";
import { civilDateString } from "../../lib/civil-date";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getDailySummary: vi.fn(),
    getUser: vi.fn(),
  },
}));

type Day = {
  date: string;
  logged: boolean;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  proteinMet: boolean | null;
  caloriesMet: boolean | null;
};
type History = {
  from: string;
  to: string;
  goals: Record<string, number | null>;
  sensitive: boolean;
  days: Day[];
};

const summary = (calories: number, protein: number, itemCount = 3) => ({
  totalCalories: calories,
  totalProtein: protein,
  totalCarbs: 100,
  totalFat: 50,
  itemCount,
});

function run(args: Record<string, unknown>, tz = "UTC") {
  return executeToolCall("get_intake_history", args, "user-1", null, tz, {
    writeCards: true,
  }) as Promise<History>;
}

describe("get_intake_history (Coach: several days in one call)", () => {
  beforeEach(() => {
    vi.mocked(storage.getDailySummary).mockReset();
    vi.mocked(storage.getUser).mockReset();
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({
        id: "user-1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 100,
        dailyCarbsGoal: null,
        dailyFatGoal: null,
      }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue(summary(2000, 120));
  });

  it("is offered only to an app that can show cards", () => {
    const names = (opts: { writeCards?: boolean }) =>
      getToolDefinitions(opts).map((t) =>
        t.type === "function" ? t.function.name : "",
      );
    expect(names({ writeCards: true })).toContain("get_intake_history");
    expect(names({})).not.toContain("get_intake_history");
  });

  it("tells the model how goals are judged and what an unlogged day means", () => {
    const def = getToolDefinitions({ writeCards: true }).find(
      (t) => t.type === "function" && t.function.name === "get_intake_history",
    );
    const text = def?.type === "function" ? def.function.description : "";
    expect(text).toMatch(/at least 90% of it/);
    expect(text).toMatch(/within 10% either way/);
    expect(text).toMatch(/a later endDate reads up to today/);
    expect(text).toMatch(/never say the user ate nothing/);
    expect(text).toMatch(/never scold a missed day/);
    expect(text).toMatch(/can also mean thinly logged days/);
    expect(text).toMatch(/never say or imply the user ate too little/);
  });

  it("returns one row per day, oldest first, ending on the given day, for this user only", async () => {
    const out = await run({ days: 3, endDate: "2026-11-20" });
    expect(out.from).toBe("2026-11-18");
    expect(out.to).toBe("2026-11-20");
    expect(out.days.map((d) => d.date)).toEqual([
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
    // Three days shown; the guard always reads the whole last week.
    expect(storage.getDailySummary).toHaveBeenCalledTimes(7);
    for (const call of vi.mocked(storage.getDailySummary).mock.calls) {
      expect(call[0]).toBe("user-1");
      expect(call[2]).toBe("UTC");
    }
    expect(storage.getUser).toHaveBeenCalledWith("user-1");
  });

  it("reads 28 days in one call, with real numbers and goal flags", async () => {
    vi.mocked(storage.getDailySummary).mockImplementation(async (_u, date) =>
      // Protein alternates between a met day and a short one.
      date.getUTCDate() % 2 === 0 ? summary(2000, 95) : summary(1950, 40),
    );
    const out = await run({ days: 28, endDate: "2026-11-20" });
    expect(out.days).toHaveLength(28);
    expect(out.goals).toEqual({
      calories: 2000,
      protein: 100,
      carbs: null,
      fat: null,
    });
    const last = out.days.at(-1)!;
    expect(last).toMatchObject({
      date: "2026-11-20",
      logged: true,
      calories: 2000,
      protein: 95,
      proteinMet: true,
      caloriesMet: true,
    });
    expect(out.days.at(-2)).toMatchObject({ protein: 40, proteinMet: false });
  });

  it("marks a day with nothing logged as not logged, with no goal flags", async () => {
    vi.mocked(storage.getDailySummary).mockResolvedValue(summary(0, 0, 0));
    const out = await run({ days: 1, endDate: "2026-11-20" });
    expect(out.days[0]).toMatchObject({
      logged: false,
      items: 0,
      calories: null,
      protein: null,
      proteinMet: null,
      caloriesMet: null,
    });
  });

  it("gives no goal flag for a goal the user has not set", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({
        id: "user-1",
        dailyCalorieGoal: null,
        dailyProteinGoal: null,
        dailyCarbsGoal: null,
        dailyFatGoal: null,
      }),
    );
    const out = await run({ days: 1, endDate: "2026-11-20" });
    expect(out.goals.protein).toBeNull();
    expect(out.days[0].proteinMet).toBeNull();
    expect(out.days[0].caloriesMet).toBeNull();
  });

  it("defaults to the last seven days ending today in the user's zone", async () => {
    const tz = "Pacific/Kiritimati";
    const out = await run({}, tz);
    expect(out.days).toHaveLength(7);
    expect(out.to).toBe(civilDateString(new Date(), tz));
  });

  it("reads each local day across a clock change, at that day's local midnight", async () => {
    // US clocks went back on 2026-11-01: that day is 25 hours long.
    const tz = "America/New_York";
    const out = await run({ days: 3, endDate: "2026-11-02" }, tz);
    expect(out.days.map((d) => d.date)).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    const instants = vi
      .mocked(storage.getDailySummary)
      .mock.calls.slice(-3)
      .map((c) => (c[1] as Date).toISOString());
    expect(instants).toEqual([
      "2026-10-31T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ]);
  });

  it("never reads past today", async () => {
    const out = await run({ days: 2, endDate: "2999-01-01" });
    expect(out.to).toBe(civilDateString(new Date(), "UTC"));
  });

  it("refuses more than 35 days", async () => {
    const out = (await run({ days: 36 })) as unknown as { error: string };
    expect(out.error).toBeTruthy();
    expect(storage.getDailySummary).not.toHaveBeenCalled();
  });

  it("judges the guard over the last seven days too, so a short window cannot dodge it", async () => {
    // Nov 20 looks normal; the six days before it are under the safe line.
    vi.mocked(storage.getDailySummary).mockImplementation(async (_u, date) =>
      date.toISOString().startsWith("2026-11-20")
        ? summary(2000, 120)
        : summary(900, 30),
    );
    const out = await run({ days: 1, endDate: "2026-11-20" });
    expect(out.days).toHaveLength(1);
    expect(out.from).toBe("2026-11-20");
    expect(out.sensitive).toBe(true);
    expect(out.days[0].calories).toBeNull();
  });

  it("judges the guard over the last seven days of a long window", async () => {
    // A normal month whose last week is under the safe line.
    vi.mocked(storage.getDailySummary).mockImplementation(async (_u, date) =>
      date.toISOString() >= "2026-11-14"
        ? summary(900, 30)
        : summary(2000, 120),
    );
    const out = await run({ days: 35, endDate: "2026-11-20" });
    expect(out.sensitive).toBe(true);
  });

  it("hides intake numbers for a week of one tiny log a day", async () => {
    vi.mocked(storage.getDailySummary).mockResolvedValue(summary(150, 5, 1));
    const out = await run({ days: 7, endDate: "2026-11-20" });
    expect(out.sensitive).toBe(true);
    expect(out.days.every((d) => d.calories === null)).toBe(true);
  });

  it("shows a normal week with a couple of one-item days (control)", async () => {
    vi.mocked(storage.getDailySummary).mockImplementation(async (_u, date) =>
      ["2026-11-19", "2026-11-20"].some((d) => date.toISOString().startsWith(d))
        ? summary(300, 10, 1)
        : summary(2000, 120),
    );
    const out = await run({ days: 7, endDate: "2026-11-20" });
    expect(out.sensitive).toBe(false);
    expect(out.days.at(-1)?.calories).toBe(300);
  });

  it("hides intake numbers when most full days are under the safe line", async () => {
    vi.mocked(storage.getDailySummary).mockResolvedValue(summary(900, 30));
    const out = await run({ days: 7, endDate: "2026-11-20" });
    expect(out.sensitive).toBe(true);
    for (const d of out.days) {
      expect(d.calories).toBeNull();
      expect(d.protein).toBeNull();
      expect(d.proteinMet).toBeNull();
      expect(d.caloriesMet).toBeNull();
    }
    expect(out.days[0].logged).toBe(true);
  });
});
