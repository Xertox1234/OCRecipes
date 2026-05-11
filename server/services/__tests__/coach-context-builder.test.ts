import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildCoachContext } from "../coach-context-builder";
import { storage } from "../../storage";
import {
  createMockCoachNotebookEntry,
  createMockUser,
  createMockUserProfile,
} from "../../__tests__/factories";
import { TIER_FEATURES } from "@shared/types/premium";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getActiveNotebookEntries: vi.fn(),
    getCommitmentsWithDueFollowUp: vi.fn(),
    getUser: vi.fn(),
  },
}));

function setupDefaults() {
  const emptyProfile = createMockUserProfile({
    dietType: null,
    allergies: [],
  });
  Object.assign(emptyProfile, { foodDislikes: null });

  vi.mocked(storage.getUserProfile).mockResolvedValue(emptyProfile);
  vi.mocked(storage.getDailySummary).mockResolvedValue({
    totalCalories: 1200,
    totalProtein: 60,
    totalCarbs: 140,
    totalFat: 40,
    itemCount: 4,
  });
  vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
  vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([]);
  vi.mocked(storage.getUser).mockResolvedValue(
    createMockUser({ dailyProteinGoal: 150 }),
  );
}

describe("buildCoachContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T08:00:00Z"));
    setupDefaults();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds context for an empty profile", async () => {
    const result = await buildCoachContext("user-1", TIER_FEATURES.premium);

    expect(result.goals).toBeNull();
    expect(result.dietaryProfile).toEqual({
      dietType: null,
      allergies: [],
      dislikes: null,
    });
    expect(result.suggestions).toEqual([
      "I need 90g more protein today",
      "Quick breakfast ideas",
      "What should I eat next?",
    ]);
  });

  it("builds context for a full profile and formats restrictions", async () => {
    vi.setSystemTime(new Date("2026-05-11T18:30:00Z"));
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({
        dietType: "high-protein",
        allergies: [
          { name: "peanuts", severity: "severe" },
          { name: "shellfish", severity: "mild" },
          { name: "", severity: "mild" },
        ],
        foodDislikes: ["olives", "cilantro"],
      }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 1400,
      totalProtein: 120,
      totalCarbs: 130,
      totalFat: 50,
      itemCount: 5,
    });
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ dailyProteinGoal: 165 }),
    );
    vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([
      createMockCoachNotebookEntry({
        id: 41,
        type: "observation",
        content: "Post-workout meals improve adherence",
      }),
    ]);
    vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([
      createMockCoachNotebookEntry({
        id: 9,
        type: "commitment",
        content: "Avoid sugary snacks after dinner",
      }),
    ]);

    const result = await buildCoachContext("user-1", TIER_FEATURES.premium);

    expect(result.dietaryProfile).toEqual({
      dietType: "high-protein",
      allergies: ["peanuts", "shellfish"],
      dislikes: ["olives", "cilantro"],
    });
    expect(result.notebook).toEqual([
      {
        id: 41,
        type: "observation",
        content: "Post-workout meals improve adherence",
        status: "active",
        followUpDate: null,
        updatedAt: expect.any(Date),
      },
    ]);
    expect(result.suggestions).toEqual([
      'How did "Avoid sugary snacks after dinner" go?',
      "I need 45g more protein today",
      "How was my day?",
    ]);
  });

  it("handles partial profile values and null allergies", async () => {
    const partialProfile = createMockUserProfile({
      dietType: null,
      foodDislikes: ["mushrooms"],
    });
    Object.assign(partialProfile, { allergies: null });

    vi.mocked(storage.getUserProfile).mockResolvedValue(partialProfile);

    const result = await buildCoachContext("user-1", TIER_FEATURES.premium);

    expect(result.dietaryProfile).toEqual({
      dietType: null,
      allergies: [],
      dislikes: ["mushrooms"],
    });
  });

  it("produces the same output for free and premium feature flags", async () => {
    const premiumResult = await buildCoachContext(
      "user-1",
      TIER_FEATURES.premium,
    );
    const freeResult = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(freeResult).toEqual(premiumResult);
  });
});
