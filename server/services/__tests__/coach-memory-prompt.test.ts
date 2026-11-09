import { describe, it, expect } from "vitest";
import {
  assembleCoachContext,
  buildCoachSuggestions,
} from "../coach-context-builder";
import { buildSystemPrompt } from "../nutrition-coach";
import {
  createMockCoachNotebookEntry,
  createMockUserProfile,
} from "../../__tests__/factories";

const NOW = new Date("2026-11-08T12:00:00Z");
const user = {
  dailyCalorieGoal: 1949,
  dailyProteinGoal: 120,
  dailyCarbsGoal: null,
  dailyFatGoal: null,
  weight: null,
  goalWeight: null,
  measurementUnit: "metric" as const,
};
const summary = {
  totalCalories: 0,
  totalProtein: 0,
  totalCarbs: 0,
  totalFat: 0,
  itemCount: 0,
};

function assemble(over: Partial<Parameters<typeof assembleCoachContext>[0]>) {
  return assembleCoachContext({
    isCoachPro: true,
    user,
    tz: "UTC",
    profile: undefined,
    dailySummary: summary,
    recentLogsForPatterns: [],
    notebookEntries: [],
    dueCommitments: [],
    frequentFoods: [],
    now: NOW,
    ...over,
  });
}

const confirmed = new Date("2026-11-01T00:00:00Z");

describe("assembleCoachContext — the certainty rule", () => {
  it("only confirmed goals, preferences and commitments can be mentioned, with ids", () => {
    const ctx = assemble({
      notebookEntries: [
        createMockCoachNotebookEntry({
          id: 5,
          type: "preference",
          content: "Avoids dairy",
          confirmedAt: confirmed,
        }),
        createMockCoachNotebookEntry({
          id: 6,
          type: "goal",
          content: "Unconfirmed goal",
        }),
        createMockCoachNotebookEntry({
          id: 7,
          type: "insight",
          content: "Snacks late",
          confirmedAt: confirmed,
        }),
      ],
    });
    expect(ctx.notebookSummary).toContain("[#5 preference]");
    expect(ctx.notebookSummary).toContain("Avoids dairy");
    expect(ctx.notebookSummary).not.toContain("Unconfirmed goal");
    expect(ctx.notebookSummary).not.toContain("Snacks late");
    expect(ctx.notebookBackground).toContain("Unconfirmed goal");
    expect(ctx.notebookBackground).toContain("Snacks late");
    expect(ctx.notebookBackground).not.toContain("#6");
    expect(ctx.notebookSummary).not.toMatch(
      /recent|this week|this month|older/,
    );
  });

  it("checks in only on a confirmed, labelled commitment, by its label", () => {
    const labelled = createMockCoachNotebookEntry({
      id: 9,
      type: "commitment",
      content: "The user agreed to add pumpkin seeds",
      label: "pumpkin seeds on your salad",
      confirmedAt: confirmed,
    });
    const unconfirmed = { ...labelled, id: 10, confirmedAt: null };
    expect(
      assemble({ dueCommitments: [unconfirmed] }).dueCommitmentsSummary,
    ).toBeUndefined();
    const ctx = assemble({ dueCommitments: [labelled, unconfirmed] });
    expect(ctx.dueCommitmentsSummary).toContain("pumpkin seeds on your salad");
    expect(ctx.dueCommitmentsSummary).not.toContain("The user agreed");
  });

  it("passes a mood band, never a number", () => {
    const ctx = assemble({
      profile: createMockUserProfile({ moodScore: -1, moodUpdatedAt: NOW }),
    });
    expect(ctx.moodBand).toBe("low");
  });
});

describe("buildCoachSuggestions — the commitment chip", () => {
  const base = { totalProtein: null, proteinGoal: null, now: NOW, tz: "UTC" };

  it("asks about a confirmed, labelled commitment with curiosity", () => {
    expect(
      buildCoachSuggestions({
        ...base,
        dueCommitments: [
          { label: "pumpkin seeds on your salad", confirmedAt: confirmed },
        ],
      })[0],
    ).toBe("How's pumpkin seeds on your salad going?");
  });

  it("offers no commitment chip for an unconfirmed or unlabelled one", () => {
    for (const c of [
      { label: "x", confirmedAt: null },
      { label: null, confirmedAt: confirmed },
    ]) {
      const chips = buildCoachSuggestions({ ...base, dueCommitments: [c] });
      expect(chips.some((s) => s.startsWith("How's"))).toBe(false);
    }
  });
});

describe("buildSystemPrompt — recall phrasing", () => {
  const prompt = (ctx: Parameters<typeof buildSystemPrompt>[0]) =>
    buildSystemPrompt(ctx, "personalized_advice", { now: NOW, tier: "pro" });
  const ctx = {
    goals: null,
    todayIntake: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
    notebookSummary:
      "[#5 preference] <notebook_entry>Avoids dairy</notebook_entry>",
    notebookBackground:
      "[insight] <notebook_entry>Snacks late</notebook_entry>",
    dueCommitmentsSummary:
      "[commitment] <notebook_entry>pumpkin seeds</notebook_entry>",
    moodBand: "low" as const,
  };

  it("drops the time claim and the check-in-first instruction", () => {
    const p = prompt(ctx);
    expect(p).not.toContain("Last week you mentioned");
    expect(p).not.toContain("Open your reply by checking in");
    expect(p).not.toContain("labelled with recency");
  });

  it("answers first, then checks in with curiosity, never on a low mood", () => {
    const p = prompt(ctx);
    expect(p).toContain("Answer the user's message first");
    expect(p).toContain("curiosity");
    expect(p).toMatch(/skip the check-in.*mood is low/i);
  });

  it("keeps background notes silent and names the band only", () => {
    const p = prompt(ctx);
    expect(p).toContain("Snacks late");
    expect(p).toMatch(/never mention.*background/i);
    expect(p).toContain("recent mood: low");
    expect(p).not.toMatch(/mood score/i);
  });
});
