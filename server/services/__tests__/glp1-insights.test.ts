import { analyzeGlp1Insights } from "../glp1-insights";

import { storage } from "../../storage";

// Mock the storage module
vi.mock("../../storage", () => ({
  storage: {
    getMedicationLogs: vi.fn(),
    getUserProfile: vi.fn(),
    getWeightLogs: vi.fn(),
  },
}));

const mockStorage = vi.mocked(storage);

function makeMedLog(overrides: {
  id?: number;
  takenAt: Date;
  appetiteLevel?: number | null;
  sideEffects?: string[];
}) {
  return {
    id: overrides.id ?? 1,
    userId: "user-1",
    medicationName: "Semaglutide",
    brandName: "Ozempic",
    dosage: "0.5mg",
    takenAt: overrides.takenAt,
    sideEffects: overrides.sideEffects ?? [],
    appetiteLevel: overrides.appetiteLevel ?? null,
    notes: null,
  };
}

describe("GLP-1 Insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeroed insights when no medication logs exist", async () => {
    mockStorage.getMedicationLogs.mockResolvedValue([]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.totalDoses).toBe(0);
    expect(result.daysSinceStart).toBeNull();
    expect(result.averageAppetiteLevel).toBeNull();
    expect(result.appetiteTrend).toBeNull();
    expect(result.commonSideEffects).toEqual([]);
    expect(result.weightChangeSinceStart).toBeNull();
    expect(result.lastDoseAt).toBeNull();
    expect(result.nextDoseEstimate).toBeNull();
  });

  it("counts total doses correctly", async () => {
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: new Date("2026-02-20") }),
      makeMedLog({ id: 2, takenAt: new Date("2026-02-13") }),
      makeMedLog({ id: 3, takenAt: new Date("2026-02-06") }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.totalDoses).toBe(3);
  });

  it("calculates days since start from profile", async () => {
    // Use a fixed time to avoid off-by-one from time-of-day differences
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00Z"));

    const startDate = new Date("2026-02-07T12:00:00Z"); // exactly 30 days before

    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ takenAt: new Date("2026-03-09T12:00:00Z") }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue({
      id: 1,
      userId: "user-1",
      glp1StartDate: startDate.toISOString(),
      allergies: [],
      dietType: null,
      primaryGoal: null,
      activityLevel: null,
      cookingSkillLevel: null,
      cookingTimeAvailable: null,
      healthConditions: null,
      foodDislikes: null,
      cuisinePreferences: null,
      householdSize: null,
      height: null,
      weight: null,
      age: null,
      sex: null,
      weeklyBudget: null,
    } as any);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.daysSinceStart).toBe(30);

    vi.useRealTimers();
  });

  it("calculates average appetite level", async () => {
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: new Date("2026-02-20"), appetiteLevel: 4 }),
      makeMedLog({ id: 2, takenAt: new Date("2026-02-13"), appetiteLevel: 6 }),
      makeMedLog({ id: 3, takenAt: new Date("2026-02-06"), appetiteLevel: 8 }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.averageAppetiteLevel).toBe(6);
  });

  it("detects decreasing appetite trend", async () => {
    // Logs sorted desc (newest first): newer have lower appetite
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: new Date("2026-02-20"), appetiteLevel: 3 }),
      makeMedLog({ id: 2, takenAt: new Date("2026-02-18"), appetiteLevel: 4 }),
      makeMedLog({ id: 3, takenAt: new Date("2026-02-16"), appetiteLevel: 7 }),
      makeMedLog({ id: 4, takenAt: new Date("2026-02-14"), appetiteLevel: 8 }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.appetiteTrend).toBe("decreasing");
  });

  it("detects increasing appetite trend", async () => {
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: new Date("2026-02-20"), appetiteLevel: 8 }),
      makeMedLog({ id: 2, takenAt: new Date("2026-02-18"), appetiteLevel: 7 }),
      makeMedLog({ id: 3, takenAt: new Date("2026-02-16"), appetiteLevel: 3 }),
      makeMedLog({ id: 4, takenAt: new Date("2026-02-14"), appetiteLevel: 2 }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.appetiteTrend).toBe("increasing");
  });

  it("detects stable appetite trend", async () => {
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: new Date("2026-02-20"), appetiteLevel: 5 }),
      makeMedLog({ id: 2, takenAt: new Date("2026-02-18"), appetiteLevel: 5 }),
      makeMedLog({ id: 3, takenAt: new Date("2026-02-16"), appetiteLevel: 5 }),
      makeMedLog({ id: 4, takenAt: new Date("2026-02-14"), appetiteLevel: 5 }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.appetiteTrend).toBe("stable");
  });

  it("counts and ranks common side effects", async () => {
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({
        id: 1,
        takenAt: new Date("2026-02-20"),
        sideEffects: ["nausea", "fatigue"],
      }),
      makeMedLog({
        id: 2,
        takenAt: new Date("2026-02-13"),
        sideEffects: ["nausea", "headache"],
      }),
      makeMedLog({
        id: 3,
        takenAt: new Date("2026-02-06"),
        sideEffects: ["nausea"],
      }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.commonSideEffects[0]).toEqual({ name: "nausea", count: 3 });
    expect(result.commonSideEffects).toHaveLength(3);
    // Sorted by count desc
    expect(result.commonSideEffects[0].count).toBeGreaterThanOrEqual(
      result.commonSideEffects[1].count,
    );
  });

  it("limits side effects to top 5", async () => {
    const effects = [
      "nausea",
      "fatigue",
      "headache",
      "diarrhea",
      "constipation",
      "dizziness",
      "vomiting",
    ];
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({
        id: 1,
        takenAt: new Date("2026-02-20"),
        sideEffects: effects,
      }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.commonSideEffects.length).toBeLessThanOrEqual(5);
  });

  it("sets lastDoseAt from most recent log", async () => {
    const recentDate = new Date("2026-02-20T10:00:00Z");
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: recentDate }),
      makeMedLog({ id: 2, takenAt: new Date("2026-02-13T10:00:00Z") }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.lastDoseAt).toBe(recentDate.toISOString());
  });

  it("estimates next dose based on average interval", async () => {
    // Two doses 7 days apart → next dose is 7 days after last
    const dose1 = new Date("2026-02-20T10:00:00Z");
    const dose2 = new Date("2026-02-13T10:00:00Z");
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ id: 1, takenAt: dose1 }),
      makeMedLog({ id: 2, takenAt: dose2 }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getWeightLogs.mockResolvedValue([]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.nextDoseEstimate).toBeDefined();
    const nextDose = new Date(result.nextDoseEstimate!);
    // Should be ~7 days after 2026-02-20
    const expectedNext = new Date("2026-02-27T10:00:00Z");
    expect(Math.abs(nextDose.getTime() - expectedNext.getTime())).toBeLessThan(
      3600000,
    ); // within 1 hour
  });

  it("calculates weight change since GLP-1 start", async () => {
    const startDate = "2026-01-01T00:00:00Z";
    mockStorage.getMedicationLogs.mockResolvedValue([
      makeMedLog({ takenAt: new Date("2026-02-20") }),
    ]);
    mockStorage.getUserProfile.mockResolvedValue({
      id: 1,
      userId: "user-1",
      glp1StartDate: startDate,
    } as any);
    mockStorage.getWeightLogs.mockResolvedValue([
      // Most recent weight (sorted desc)
      {
        id: 2,
        userId: "user-1",
        weight: "85",
        unit: "kg",
        source: "manual",
        note: null,
        loggedAt: new Date("2026-02-20"),
      },
      // Weight before start
      {
        id: 1,
        userId: "user-1",
        weight: "90",
        unit: "kg",
        source: "manual",
        note: null,
        loggedAt: new Date("2025-12-30"),
      },
    ]);

    const result = await analyzeGlp1Insights("user-1");

    expect(result.weightChangeSinceStart).toBe(-5);
  });
});
