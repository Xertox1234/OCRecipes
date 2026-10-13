// server/services/inspired-recipes/__tests__/suggest-listing.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

import { aiChat } from "../../../lib/ai-client";
import {
  createMockChatCompletion,
  createMockUserProfile,
} from "../../../__tests__/factories";
import {
  suggestListing,
  buildProfileBrief,
  dropAllergenConflicts,
} from "../suggest-listing";

vi.mock("../../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../../lib/openai", () => ({ OPENAI_TIMEOUT_FAST_MS: 15_000 }));

const mockAi = vi.mocked(aiChat);
const reply = (json: unknown) => createMockChatCompletion(JSON.stringify(json));

const card = (title: string) => ({
  title,
  description: "A bright, quick weeknight dish with lots of flavour.",
  totalMinutes: 25,
  tags: ["quick"],
});

const profile = createMockUserProfile({
  dietType: "vegetarian",
  allergies: [{ name: "peanuts", severity: "severe" }],
  healthConditions: ["SECRET_CONDITION_XYZ"],
  householdSize: 3,
  primaryGoal: "eat_healthier",
});

const args = (over: Record<string, unknown> = {}) => ({
  request: "t",
  inspirationTitles: [],
  profile: null,
  count: 5,
  ...over,
});

beforeEach(() => mockAi.mockReset());

describe("suggestListing", () => {
  it("sends only titles + allowed profile fields, never healthConditions", async () => {
    mockAi.mockResolvedValue(reply({ suggestions: [card("Bean Tacos")] }));
    await suggestListing({
      request: "tacos",
      inspirationTitles: ["Spicy Chipotle Tacos"],
      profile,
      count: 5,
    });
    const body = JSON.stringify(mockAi.mock.calls[0][1]);
    expect(body).toContain("Spicy Chipotle Tacos");
    expect(body).toContain("Diet type: vegetarian");
    expect(body).toContain("Household: 3");
    expect(body).not.toContain("SECRET_CONDITION_XYZ");
  });

  it("works with zero inspiration titles", async () => {
    mockAi.mockResolvedValue(reply({ suggestions: [card("Bean Tacos")] }));
    const out = await suggestListing(args({ request: "tacos" }));
    expect(out).toHaveLength(1);
  });

  it("keeps valid cards and drops invalid ones; null if none valid", async () => {
    mockAi.mockResolvedValue(
      reply({ suggestions: [card("Good Tacos"), { title: "x" }] }),
    );
    const out = await suggestListing(args());
    expect(out?.map((c) => c.title)).toEqual(["Good Tacos"]);

    mockAi.mockResolvedValue(reply({ suggestions: [{ title: "x" }] }));
    expect(await suggestListing(args())).toBeNull();
  });

  it("caps output at count", async () => {
    mockAi.mockResolvedValue(
      reply({
        suggestions: [1, 2, 3, 4, 5, 6, 7].map((n) => card(`Dish ${n}`)),
      }),
    );
    const out = await suggestListing(args());
    expect(out).toHaveLength(5);
  });

  it("returns null when the AI call throws or returns non-JSON", async () => {
    mockAi.mockRejectedValue(new Error("boom"));
    expect(await suggestListing(args())).toBeNull();
    mockAi.mockResolvedValue(createMockChatCompletion("not json"));
    expect(await suggestListing(args())).toBeNull();
  });
});

describe("dropAllergenConflicts", () => {
  it("drops a card whose text mentions a listed allergen", () => {
    const out = dropAllergenConflicts(
      [card("Peanut Noodles"), card("Bean Tacos")],
      profile,
    );
    expect(out.map((c) => c.title)).toEqual(["Bean Tacos"]);
  });
});

describe("buildProfileBrief", () => {
  it("includes household and goal, excludes health conditions", () => {
    const brief = buildProfileBrief(profile);
    expect(brief).toContain("Household: 3");
    expect(brief).toContain("eat_healthier");
    expect(brief).not.toContain("SECRET_CONDITION_XYZ");
  });
});
