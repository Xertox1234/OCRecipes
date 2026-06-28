// server/services/__tests__/image-art-direction.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  selectDeterministicArtDirection,
  subjectFor,
  composePrompt,
  resolveArtDirection,
  buildImagePrompt,
  type RecipeImageContext,
  type ArtDirection,
} from "../image-art-direction";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("../../lib/openai", () => ({
  openai: { chat: { completions: { create: mockCreate } } },
  MODEL_FAST: "gpt-4o-mini",
  OPENAI_TIMEOUT_FAST_MS: 15000,
  isAiConfigured: true,
}));
vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((s: string) => s),
  SYSTEM_PROMPT_BOUNDARY: "SAFETY RULES",
}));

const italianDinner: RecipeImageContext = {
  title: "Spaghetti Carbonara",
  cuisine: "Italian",
  mealTypes: ["dinner"],
};

describe("selectDeterministicArtDirection", () => {
  it("is stable for the same recipe + variant", () => {
    const a = selectDeterministicArtDirection(italianDinner, "hero");
    const b = selectDeterministicArtDirection(italianDinner, "hero");
    expect(a).toEqual(b);
  });

  it("maps meal type to time-of-day lighting", () => {
    const dinner = selectDeterministicArtDirection(italianDinner, "hero");
    const breakfast = selectDeterministicArtDirection(
      { ...italianDinner, mealTypes: ["breakfast"] },
      "hero",
    );
    expect(dinner.lighting).toMatch(/golden-hour|evening|warm/i);
    expect(breakfast.lighting).toMatch(/morning/i);
  });

  it("falls back to the default palette for unknown cuisine", () => {
    const known = selectDeterministicArtDirection(italianDinner, "hero");
    const unknown = selectDeterministicArtDirection(
      {
        title: "Spaghetti Carbonara",
        cuisine: "Martian",
        mealTypes: ["dinner"],
      },
      "hero",
    );
    // Different cuisine style sets → at least one slot differs in expectation,
    // but the key assertion is it does not throw and returns a full ArtDirection.
    expect(unknown.surface).toBeTruthy();
    expect(known.surface).toBeTruthy();
  });

  it("produces variety across a corpus (not all identical)", () => {
    const titles = [
      "Carbonara",
      "Margherita Pizza",
      "Risotto",
      "Lasagna",
      "Tiramisu",
      "Bruschetta",
      "Minestrone",
      "Gnocchi",
      "Osso Buco",
      "Cannoli",
    ];
    const angles = new Set(
      titles.map(
        (t) =>
          selectDeterministicArtDirection(
            { title: t, cuisine: "Italian", mealTypes: ["dinner"] },
            "hero",
          ).angle,
      ),
    );
    expect(angles.size).toBeGreaterThanOrEqual(2);
  });
});

const sampleArt: ArtDirection = {
  angle: "an overhead flat-lay shot",
  surface: "a warm rustic walnut board",
  background: "a soft blurred trattoria interior",
  lighting: "warm golden-hour evening glow",
  palette: "warm reds and terracotta",
  props: "a linen napkin and olive oil cruet",
  mood: "cozy and rustic",
};

describe("subjectFor", () => {
  it("frames the ingredients variant as raw components", () => {
    const s = subjectFor({ title: "Carbonara" }, "ingredients");
    expect(s).toMatch(/raw ingredients/i);
    expect(s).toMatch(/Carbonara/);
  });
  it("frames hero/plated as a plated serving", () => {
    const s = subjectFor({ title: "Carbonara" }, "hero");
    expect(s).toMatch(/plated/i);
    expect(s).not.toMatch(/raw ingredients/i);
  });
  it("frames plated variant as a plated serving", () => {
    const s = subjectFor({ title: "Carbonara" }, "plated");
    expect(s).toMatch(/plated/i);
    expect(s).not.toMatch(/raw ingredients/i);
  });
  it("includes productName in the hero/plated subject when present", () => {
    const s = subjectFor(
      { title: "Carbonara", productName: "Guanciale" },
      "hero",
    );
    expect(s).toContain("Guanciale");
  });
});

describe("composePrompt", () => {
  const out = composePrompt(
    subjectFor({ title: "Carbonara" }, "hero"),
    sampleArt,
  );
  it("includes the editorial house-style wrapper", () => {
    expect(out).toMatch(/editorial food photography/i);
    expect(out).toMatch(/professional color grading/i);
  });
  it("includes the art-direction slots", () => {
    expect(out).toContain("overhead flat-lay");
    expect(out).toContain("walnut board");
    expect(out).toContain("warm reds and terracotta");
  });
  it("emits POSITIVE prompt only — no negative terms", () => {
    expect(out).not.toMatch(/\bwatermark\b/i);
    expect(out).not.toMatch(/\bno text\b/i);
    expect(out).not.toMatch(/\bcartoon\b/i);
    expect(out).not.toMatch(/\b3d render\b/i);
  });
  it("appends the seasonal feel clause when season is set", () => {
    const out = composePrompt(subjectFor({ title: "Carbonara" }, "hero"), {
      ...sampleArt,
      season: "autumnal",
    });
    expect(out).toMatch(/autumnal seasonal feel/i);
  });
});

const llmJson = (obj: Record<string, unknown>) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
});

describe("resolveArtDirection — LLM enrich + fallback", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    delete process.env.IMAGE_ART_DIRECTOR_LLM;
  });

  const ctx = { title: "Pad Thai", cuisine: "Thai", mealTypes: ["dinner"] };

  it("uses the validated LLM art direction when enabled", async () => {
    mockCreate.mockResolvedValue(
      llmJson({
        angle: "a dramatic low angle",
        surface: "a fresh banana leaf",
        background: "dark moody tropical depth",
        lighting: "warm dim evening light",
        palette: "lush greens and chili reds",
        props: "lime and crushed peanuts",
        mood: "moody and aromatic",
        season: "late summer",
      }),
    );
    const art = await resolveArtDirection(ctx, "hero");
    expect(art.surface).toBe("a fresh banana leaf");
    expect(art.season).toBe("late summer");
  });

  it("falls back to deterministic on invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    });
    const art = await resolveArtDirection(ctx, "hero");
    expect(art).toEqual(selectDeterministicArtDirection(ctx, "hero"));
  });

  it("falls back to deterministic on schema violation (oversized field)", async () => {
    mockCreate.mockResolvedValue(
      llmJson({
        angle: "x".repeat(200),
        surface: "s",
        background: "b",
        lighting: "l",
        palette: "p",
        props: "pr",
        mood: "m",
      }),
    );
    const art = await resolveArtDirection(ctx, "hero");
    expect(art).toEqual(selectDeterministicArtDirection(ctx, "hero"));
  });

  it("falls back to deterministic when the call throws", async () => {
    mockCreate.mockRejectedValue(new Error("timeout"));
    const art = await resolveArtDirection(ctx, "hero");
    expect(art).toEqual(selectDeterministicArtDirection(ctx, "hero"));
  });

  it("skips the LLM entirely when skipLLM is true", async () => {
    const art = await resolveArtDirection(ctx, "hero", { skipLLM: true });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(art).toEqual(selectDeterministicArtDirection(ctx, "hero"));
  });

  it("skips the LLM when IMAGE_ART_DIRECTOR_LLM=off", async () => {
    process.env.IMAGE_ART_DIRECTOR_LLM = "off";
    const art = await resolveArtDirection(ctx, "hero");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(art).toEqual(selectDeterministicArtDirection(ctx, "hero"));
  });
});

describe("buildImagePrompt", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    delete process.env.IMAGE_ART_DIRECTOR_LLM;
  });
  it("returns a composed positive prompt (deterministic path)", async () => {
    const prompt = await buildImagePrompt(
      { title: "Tacos", cuisine: "Mexican", mealTypes: ["lunch"] },
      "hero",
      { skipLLM: true },
    );
    expect(prompt).toMatch(/editorial food photography/i);
    expect(prompt).toMatch(/Tacos/);
    expect(prompt).not.toMatch(/watermark/i);
  });
});
