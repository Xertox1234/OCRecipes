import { buildCoachContext } from "../coach-context-builder";

import { storage } from "../../storage";
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

const mockStorage = vi.mocked(storage);

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

function makeUser(
  overrides: Partial<{ id: string; dailyProteinGoal: number | null }> = {},
) {
  return {
    id: overrides.id ?? "user-1",
    username: "tester",
    email: "tester@example.com",
    dailyCalorieGoal: 2000,
    dailyProteinGoal: overrides.dailyProteinGoal ?? 150,
    dailyCarbsGoal: 250,
    dailyFatGoal: 67,
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

function makeNotebookEntry(
  overrides: Partial<{
    id: number;
    type: string;
    content: string;
    status: string;
    followUpDate: Date | null;
    updatedAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    userId: "user-1",
    type: overrides.type ?? "insight",
    content: overrides.content ?? "Likes high-protein breakfasts",
    status: overrides.status ?? "active",
    followUpDate: overrides.followUpDate ?? null,
    sourceConversationId: null,
    dedupeKey: null,
    createdAt: new Date("2026-05-01"),
    updatedAt: overrides.updatedAt ?? new Date("2026-05-10"),
  } as any;
}

function makeProfile(
  overrides: Partial<{
    allergies: any;
    dietType: string | null;
    foodDislikes: string[] | null;
  }> = {},
) {
  return {
    id: 1,
    userId: "user-1",
    allergies: overrides.allergies ?? [],
    dietType: overrides.dietType ?? null,
    foodDislikes: overrides.foodDislikes ?? null,
    healthConditions: null,
    primaryGoal: null,
    activityLevel: null,
    householdSize: null,
    cuisinePreferences: null,
    cookingSkillLevel: null,
    cookingTimeAvailable: null,
    glp1Mode: null,
    glp1Medication: null,
    glp1StartDate: null,
    reminderMutes: null,
    healthDataConsentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

describe("buildCoachContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fix time so hour-based suggestion logic is deterministic. The builder
    // calls `new Date().getHours()` which is local-time, so build the fixed
    // date from local-time components instead of a UTC string.
    vi.useFakeTimers();
    // 13:00 local — afternoon (neither breakfast < 11 nor evening >= 17).
    vi.setSystemTime(new Date(2026, 4, 15, 13, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null goals, empty arrays, and core fallback fields for an empty profile", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(undefined);

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.goals).toBeNull();
    expect(result.dietaryProfile).toBeNull();
    expect(result.notebook).toEqual([]);
    expect(result.dueCommitments).toEqual([]);
    // The list always ends with a fallback so the panel is never empty.
    expect(result.suggestions).toContain("What should I eat next?");
  });

  it("populates goals from the user's persisted daily goal columns", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.goals).toEqual({
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 67,
    });
  });

  it("coerces a null macro goal to 0 when the user has a calorie goal", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    // `dailyProteinGoal` has no DB default — a user who never ran goal
    // calculation has a defaulted calorie goal but null macro goals.
    mockStorage.getUser.mockResolvedValue({
      ...makeUser(),
      dailyProteinGoal: null,
    });

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.goals).toEqual({
      calories: 2000,
      protein: 0,
      carbs: 250,
      fat: 67,
    });
  });

  it("builds a full dietaryProfile and includes allergen-aware data", async () => {
    mockStorage.getUserProfile.mockResolvedValue(
      makeProfile({
        dietType: "vegetarian",
        allergies: [
          { name: "peanuts", severity: "severe" },
          { name: "shellfish", severity: "mild" },
        ],
        foodDislikes: ["cilantro"],
      }),
    );
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 100 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: 150 }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.premium);

    expect(result.dietaryProfile).toEqual({
      dietType: "vegetarian",
      allergies: ["peanuts", "shellfish"],
      dislikes: ["cilantro"],
    });
  });

  it("returns empty allergies array when the profile has none and filters falsy names", async () => {
    mockStorage.getUserProfile.mockResolvedValue(
      makeProfile({
        // Include a malformed entry to verify falsy filtering.
        allergies: [
          { name: "peanuts", severity: "severe" },
          { name: "", severity: "mild" },
        ],
      }),
    );
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.dietaryProfile?.allergies).toEqual(["peanuts"]);
  });

  it("handles null allergies field defensively (treats as empty)", async () => {
    mockStorage.getUserProfile.mockResolvedValue(
      // Some legacy rows can have a null allergies field even though the
      // current default is []. The `|| []` guard in the builder must hold.
      makeProfile({ allergies: null, dietType: "keto" }),
    );
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.dietaryProfile).toEqual({
      dietType: "keto",
      allergies: [],
      dislikes: null,
    });
  });

  it("maps notebook entries to the trimmed shape (id/type/content/status/followUpDate/updatedAt)", async () => {
    const followUp = new Date("2026-06-01");
    const updated = new Date("2026-05-10");
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([
      makeNotebookEntry({
        id: 42,
        type: "commitment",
        content: "Walk after dinner",
        status: "active",
        followUpDate: followUp,
        updatedAt: updated,
      }),
    ]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.notebook).toEqual([
      {
        id: 42,
        type: "commitment",
        content: "Walk after dinner",
        status: "active",
        followUpDate: followUp,
        updatedAt: updated,
      },
    ]);
  });

  it("prefixes suggestions with a follow-up prompt when a commitment is due", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([
      makeNotebookEntry({
        id: 7,
        type: "commitment",
        content: "Try a high-protein breakfast",
      }),
    ]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.premium);

    expect(result.dueCommitments).toHaveLength(1);
    expect(result.suggestions[0]).toBe(
      'How did "Try a high-protein breakfast" go?',
    );
  });

  it("adds a protein-deficit suggestion when remaining protein > 30g", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 60 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: 150 }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    // 150 - 60 = 90g remaining, > 30 triggers the suggestion.
    expect(result.suggestions).toContain("I need 90g more protein today");
  });

  it("omits the protein-deficit suggestion when the gap is <= 30g", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 130 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: 150 }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(
      result.suggestions.some((s) => s.includes("more protein today")),
    ).toBe(false);
  });

  it("falls back to the default 150g protein goal when the user has no goal set", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 50 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: null }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    // Default 150 - 50 = 100g remaining.
    expect(result.suggestions).toContain("I need 100g more protein today");
  });

  it("includes a breakfast suggestion before 11 AM", async () => {
    vi.setSystemTime(new Date(2026, 4, 15, 8, 0, 0));
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.suggestions).toContain("Quick breakfast ideas");
  });

  it("includes a recap suggestion at or after 5 PM", async () => {
    vi.setSystemTime(new Date(2026, 4, 15, 18, 0, 0));
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.suggestions).toContain("How was my day?");
  });

  it("skips the fallback suggestion when 3+ contextual suggestions already exist", async () => {
    // commitment + protein-deficit + breakfast = 3 candidates, so the
    // `suggestions.length < 3` gate must NOT append the fallback.
    vi.setSystemTime(new Date(2026, 4, 15, 8, 0, 0));
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 50 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([
      makeNotebookEntry({ id: 1, type: "commitment", content: "drink water" }),
    ]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: 150 }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    expect(result.suggestions).toEqual([
      'How did "drink water" go?',
      "I need 100g more protein today",
      "Quick breakfast ideas",
    ]);
    expect(result.suggestions).not.toContain("What should I eat next?");
    // And the builder still applies the `.slice(0, 5)` cap as a safety net.
    expect(result.suggestions.length).toBeLessThanOrEqual(5);
  });

  it("ignores the _features argument (no free vs premium branching)", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const free = await buildCoachContext("user-1", TIER_FEATURES.free);
    const pro = await buildCoachContext("user-1", TIER_FEATURES.premium);

    // The current implementation does not branch on `_features`, so both
    // tiers must return identical context. This test pins that contract —
    // if a future change adds tier-aware logic, this assertion will fail
    // and force an explicit decision on what should differ.
    expect(free).toEqual(pro);
  });
});
