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

// The HOST timezone is an uncontrolled input for this whole file, not just the
// time-of-day block: fixtures built with the local-time `Date` constructor mean
// "8am wherever this runs". Pinned at FILE scope so every test — including the
// ones that predate the tz-aware hour — is deterministic on any machine, and so
// mutation counts are one number rather than one per developer.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

it("pins the process timezone this file claims (guards the mechanism)", () => {
  expect(new Date(2026, 6, 10).getTimezoneOffset()).toBe(0);
});

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
    // `in` check (not `??`) so tests can pass an explicit null goal.
    dailyProteinGoal:
      "dailyProteinGoal" in overrides ? overrides.dailyProteinGoal : 150,
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
    // Fix time so the hour-based suggestion logic is deterministic. The builder
    // resolves the hour in the caller's `tz` (defaulting to UTC), so the
    // fixture is a UTC instant rather than local-time components — the older
    // local-time form meant "13:00 wherever this happens to run", which landed
    // in the evening branch on a UTC-negative host and would have made the next
    // exact-suggestions assertion added here pass in CI and fail elsewhere.
    vi.useFakeTimers();
    // 13:00 UTC — afternoon (neither breakfast < 11 nor evening >= 17).
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 15, 13, 0, 0)));
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

  it("suppresses the protein-deficit suggestion when the user has no protein goal set", async () => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 50 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: null }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.free);

    // No goal set — the chip must not fabricate a number the system prompt
    // forbids the model from citing (goals absent from USER CONTEXT).
    expect(
      result.suggestions.some((s) => s.includes("more protein today")),
    ).toBe(false);
  });

  it("includes a breakfast suggestion before 11 AM", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 15, 8, 0, 0)));
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free, "UTC");

    expect(result.suggestions).toContain("Quick breakfast ideas");
  });

  it("includes a recap suggestion at or after 5 PM", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 15, 18, 0, 0)));
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary());
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(makeUser());

    const result = await buildCoachContext("user-1", TIER_FEATURES.free, "UTC");

    expect(result.suggestions).toContain("How was my day?");
  });

  it("skips the fallback suggestion when 3+ contextual suggestions already exist", async () => {
    // commitment + protein-deficit + breakfast = 3 candidates, so the
    // `suggestions.length < 3` gate must NOT append the fallback.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 15, 8, 0, 0)));
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(
      makeDailySummary({ totalProtein: 50 }),
    );
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([
      makeNotebookEntry({ id: 1, type: "commitment", content: "drink water" }),
    ]);
    mockStorage.getUser.mockResolvedValue(makeUser({ dailyProteinGoal: 150 }));

    const result = await buildCoachContext("user-1", TIER_FEATURES.free, "UTC");

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

// The time-of-day suggestion chips were gated on `new Date().getHours()` — the
// SERVER's hour, which is UTC on Railway — while `tz` was already a parameter
// of the same function. An LA user at 8am PDT (15:00 UTC) got no breakfast
// chip, and at 6pm PDT (01:00 UTC the next day) was offered breakfast ideas.
//
// The clock is pinned so "morning in LA" is a fact rather than a function of
// when CI runs, and the zone is passed as an argument, so nothing here depends
// on the host timezone.
describe("buildCoachContext — time-of-day chips use the USER's hour", () => {
  beforeEach(() => {
    mockStorage.getUserProfile.mockResolvedValue(undefined);
    mockStorage.getDailySummary.mockResolvedValue(makeDailySummary({}));
    mockStorage.getActiveNotebookEntries.mockResolvedValue([]);
    mockStorage.getCommitmentsWithDueFollowUp.mockResolvedValue([]);
    mockStorage.getUser.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  it("offers breakfast at 8am local, even though it is mid-afternoon UTC", async () => {
    at("2026-07-10T15:00:00Z"); // 08:00 in Los Angeles
    const ctx = await buildCoachContext(
      "u1",
      TIER_FEATURES.free,
      "America/Los_Angeles",
    );
    expect(ctx.suggestions).toContain("Quick breakfast ideas");
    expect(ctx.suggestions).not.toContain("How was my day?");
  });

  it("offers the evening chip at 6pm local, though UTC has rolled to the next day", async () => {
    at("2026-07-11T01:00:00Z"); // 18:00 on Jul 10 in Los Angeles
    const ctx = await buildCoachContext(
      "u1",
      TIER_FEATURES.free,
      "America/Los_Angeles",
    );
    expect(ctx.suggestions).toContain("How was my day?");
    expect(ctx.suggestions).not.toContain("Quick breakfast ideas");
  });

  it("still reads the server hour correctly when the caller has no timezone", async () => {
    at("2026-07-10T08:00:00Z"); // 08:00 UTC
    const ctx = await buildCoachContext("u1", TIER_FEATURES.free);
    expect(ctx.suggestions).toContain("Quick breakfast ideas");
  });

  it("handles midnight without emitting hour 24", async () => {
    at("2026-07-10T07:00:00Z"); // 00:00 in Los Angeles
    const ctx = await buildCoachContext(
      "u1",
      TIER_FEATURES.free,
      "America/Los_Angeles",
    );
    // 0 < 11, so the morning chip applies; an `hour12:false` formatter that
    // renders midnight as "24" would silently fall through to neither branch.
    expect(ctx.suggestions).toContain("Quick breakfast ideas");
  });
});
