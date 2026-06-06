import { getProfileWidgets } from "../profile-hub";

import { storage } from "../../storage";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getDailySummary: vi.fn(),
    getFastingSchedule: vi.fn(),
    getActiveFastingLog: vi.fn(),
  },
}));

const mockStorage = vi.mocked(storage);

function makeUser(
  overrides: Partial<{
    id: string;
    dailyCalorieGoal: number | null;
    measurementUnit: "metric" | "imperial";
  }> = {},
) {
  return {
    id: overrides.id ?? "user-1",
    username: "tester",
    email: "tester@example.com",
    dailyCalorieGoal: overrides.dailyCalorieGoal ?? 2000,
    dailyProteinGoal: 150,
    dailyCarbsGoal: 250,
    dailyFatGoal: 67,
    measurementUnit: overrides.measurementUnit ?? "metric",
    subscriptionTier: "free",
    subscriptionStatus: null,
    subscriptionExpiresAt: null,
    cookbookOwnerId: null,
    appleOriginalTransactionId: null,
    googlePurchaseToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

function makeDailySummary(
  overrides: Partial<{
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    itemCount: number;
  }> = {},
) {
  return {
    totalCalories: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    itemCount: 0,
    ...overrides,
  };
}

function makeSchedule(
  overrides: Partial<{ id: number; protocol: string }> = {},
) {
  return {
    id: overrides.id ?? 1,
    userId: "user-1",
    protocol: overrides.protocol ?? "16:8",
    fastingHours: 16,
    eatingHours: 8,
    eatingWindowStart: "12:00",
    eatingWindowEnd: "20:00",
    isActive: true,
    notifyEatingWindow: true,
    notifyMilestones: true,
    notifyCheckIns: true,
  } as any;
}

function makeFastingLog(overrides: Partial<{ id: number }> = {}) {
  return {
    id: overrides.id ?? 1,
    userId: "user-1",
    startedAt: new Date("2026-05-15T08:00:00Z"),
    endedAt: null,
    targetDurationHours: 16,
    actualDurationMinutes: null,
    completed: null,
    note: null,
  } as any;
}

describe("getProfileWidgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the user does not exist", async () => {
    mockStorage.getUser.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getFastingSchedule.mockResolvedValue(undefined);
    mockStorage.getActiveFastingLog.mockResolvedValue(undefined);

    const result = await getProfileWidgets("missing-user");

    expect(result).toBeNull();
  });

  it("assembles dailyBudget and fasting for a full happy path", async () => {
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyCalorieGoal: 1800 }));
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalCalories: 1200 }),
    );
    const schedule = makeSchedule({ protocol: "18:6" });
    mockStorage.getFastingSchedule.mockResolvedValue(schedule);
    const log = makeFastingLog();
    mockStorage.getActiveFastingLog.mockResolvedValue(log);

    const result = await getProfileWidgets("user-1");

    expect(result).toEqual({
      dailyBudget: {
        calorieGoal: 1800,
        foodCalories: 1200,
        remaining: 600,
      },
      fasting: {
        schedule,
        currentFast: log,
      },
    });
  });

  it("falls back to DEFAULT_NUTRITION_GOALS.calories when dailyCalorieGoal is null", async () => {
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyCalorieGoal: null }));
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalCalories: 500 }),
    );
    mockStorage.getFastingSchedule.mockResolvedValue(undefined);
    mockStorage.getActiveFastingLog.mockResolvedValue(undefined);

    const result = await getProfileWidgets("user-1");

    expect(result?.dailyBudget.calorieGoal).toBe(
      DEFAULT_NUTRITION_GOALS.calories,
    );
    expect(result?.dailyBudget.remaining).toBe(
      DEFAULT_NUTRITION_GOALS.calories - 500,
    );
  });

  it("falls back to DEFAULT_NUTRITION_GOALS.calories when dailyCalorieGoal is 0", async () => {
    // The service uses `user.dailyCalorieGoal || DEFAULT`, so 0 must also
    // fall back. A future refactor to `??` would silently break this — pin
    // it with an explicit test.
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyCalorieGoal: 0 }));
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalCalories: 200 }),
    );
    mockStorage.getFastingSchedule.mockResolvedValue(undefined);
    mockStorage.getActiveFastingLog.mockResolvedValue(undefined);

    const result = await getProfileWidgets("user-1");

    expect(result?.dailyBudget.calorieGoal).toBe(
      DEFAULT_NUTRITION_GOALS.calories,
    );
    expect(result?.dailyBudget.remaining).toBe(
      DEFAULT_NUTRITION_GOALS.calories - 200,
    );
  });

  it("coerces a string-typed totalCalories to a number (decimal aggregate safety)", async () => {
    // PostgreSQL decimal aggregates can return strings via Drizzle; the
    // service uses `Number(dailySummary.totalCalories) || 0` to guard.
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyCalorieGoal: 2000 }));
    mockStorage.getDailySummary.mockResolvedValue(
      // Force the string shape that the SQL aggregate produces on some drivers.

      { ...makeDailySummary(), totalCalories: "750.25" as any },
    );
    mockStorage.getFastingSchedule.mockResolvedValue(undefined);
    mockStorage.getActiveFastingLog.mockResolvedValue(undefined);

    const result = await getProfileWidgets("user-1");

    expect(result?.dailyBudget.foodCalories).toBe(750.25);
    expect(result?.dailyBudget.remaining).toBe(2000 - 750.25);
  });

  it("treats NaN/invalid totalCalories as 0 via the `|| 0` guard", async () => {
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyCalorieGoal: 2000 }));
    mockStorage.getDailySummary.mockResolvedValue({
      ...makeDailySummary(),
      totalCalories: "not-a-number" as any,
    });
    mockStorage.getFastingSchedule.mockResolvedValue(undefined);
    mockStorage.getActiveFastingLog.mockResolvedValue(undefined);

    const result = await getProfileWidgets("user-1");

    expect(result?.dailyBudget.foodCalories).toBe(0);
    expect(result?.dailyBudget.remaining).toBe(2000);
  });

  it("normalizes missing fasting schedule/log to null (not undefined)", async () => {
    mockStorage.getUser.mockResolvedValue(makeUser());
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getFastingSchedule.mockResolvedValue(undefined);
    mockStorage.getActiveFastingLog.mockResolvedValue(undefined);

    const result = await getProfileWidgets("user-1");

    expect(result?.fasting).toEqual({
      schedule: null,
      currentFast: null,
    });
  });
});
