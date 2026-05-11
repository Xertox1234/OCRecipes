import { describe, it, expect, vi, beforeEach } from "vitest";

import { getProfileWidgets } from "../profile-hub";
import { storage } from "../../storage";
import {
  createMockFastingLog,
  createMockFastingSchedule,
  createMockUser,
  createMockWeightLog,
} from "../../__tests__/factories";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getDailySummary: vi.fn(),
    getFastingSchedule: vi.fn(),
    getActiveFastingLog: vi.fn(),
    getLatestWeight: vi.fn(),
  },
}));

describe("getProfileWidgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 850,
      totalProtein: 40,
      totalCarbs: 100,
      totalFat: 25,
      itemCount: 3,
    });
    vi.mocked(storage.getFastingSchedule).mockResolvedValue(undefined);
    vi.mocked(storage.getActiveFastingLog).mockResolvedValue(undefined);
    vi.mocked(storage.getLatestWeight).mockResolvedValue(undefined);
  });

  it("returns widget data on happy path", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ dailyCalorieGoal: 2100 }),
    );
    vi.mocked(storage.getFastingSchedule).mockResolvedValue(
      createMockFastingSchedule({ protocol: "18:6", fastingHours: 18 }),
    );
    vi.mocked(storage.getActiveFastingLog).mockResolvedValue(
      createMockFastingLog({ targetDurationHours: 18 }),
    );
    vi.mocked(storage.getLatestWeight).mockResolvedValue(
      createMockWeightLog({
        weight: "158.5",
        loggedAt: new Date("2026-04-01T10:00:00Z"),
      }),
    );

    const result = await getProfileWidgets("user-1");

    expect(result).toEqual({
      dailyBudget: {
        calorieGoal: 2100,
        foodCalories: 850,
        remaining: 1250,
      },
      fasting: {
        schedule: createMockFastingSchedule({
          protocol: "18:6",
          fastingHours: 18,
        }),
        currentFast: createMockFastingLog({ targetDurationHours: 18 }),
      },
      latestWeight: {
        value: 158.5,
        unit: "lbs",
        date: "2026-04-01T10:00:00.000Z",
      },
    });
    expect(storage.getDailySummary).toHaveBeenCalledWith(
      "user-1",
      expect.any(Date),
    );
  });

  it("returns null when user is not found", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(undefined);

    const result = await getProfileWidgets("missing-user");

    expect(result).toBeNull();
  });

  it("uses default goal and normalizes invalid calories", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ dailyCalorieGoal: null }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: "not-a-number" as unknown as number,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      itemCount: 0,
    });

    const result = await getProfileWidgets("user-1");

    expect(result).toEqual({
      dailyBudget: {
        calorieGoal: DEFAULT_NUTRITION_GOALS.calories,
        foodCalories: 0,
        remaining: DEFAULT_NUTRITION_GOALS.calories,
      },
      fasting: {
        schedule: null,
        currentFast: null,
      },
      latestWeight: null,
    });
  });
});
