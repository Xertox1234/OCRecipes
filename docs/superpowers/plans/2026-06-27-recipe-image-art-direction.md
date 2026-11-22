# Recipe Image Art Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded, identical-for-every-dish image prompt with a context-aware "art direction" engine so AI recipe images vary by cuisine, meal type, and (via an optional LLM) season/mood — and refresh the existing catalogue in place.

**Architecture:** One new pure-ish module (`server/services/image-art-direction.ts`) owns "the look": a deterministic style library plus an optional LLM art-director pre-pass that returns structured JSON and always falls back to the deterministic result. Both image paths (`recipe-generation.ts` hero, `canonical-enrichment.ts` 3-shot) consume it via a threaded `RecipeImageContext`. A run-once script overwrites only our own AI images in R2 in place. The transport (`runware.ts`) and persistence (`image-store.ts`) layers are unchanged.

**Tech Stack:** TypeScript (strict), Express, Drizzle ORM (Postgres), Zod, OpenAI SDK (`gpt-4o-mini` for the stylist), Runware (FLUX) + DALL-E for image gen, Vitest, `tsx` for scripts, `p-limit` for concurrency.

## Global Constraints

- **`composePrompt` emits the POSITIVE prompt ONLY.** Negative terms (`text, watermark, logo … cartoon, illustration, 3d render`) must NEVER be concatenated into the positive prompt — that summons them. The negative prompt stays its existing separate channel: Runware's `DEFAULT_NEGATIVE_PROMPT` (`runware.ts:32`, passed via the `negativePrompt` API field) and the DALL-E suffix appended only in the DALL-E branch (`recipe-generation.ts:329`).
- **Per-table cuisine column differs:** `community_recipes.cuisineOrigin` vs `meal_plan_recipes.cuisine` (both confirmed in `shared/schema.ts`). `RecipeImageContext.cuisine` normalizes both; each call site must read its table's actual column. A wrong column reads `undefined` and silently falls back to the `default` palette — TypeScript catches the _field name_ (typed Drizzle rows), so trust the type error if one appears.
- **`recipe-chat` runs deterministic-only.** It `await`s image gen inside a `Promise.race` with a 15s timeout on a premium feature (`recipe-chat.ts:441-447`); it MUST pass `{ skipLLM: true }`. All background paths leave `skipLLM` false.
- **LLM gating:** `isArtDirectorLLMEnabled() = isAiConfigured && process.env.IMAGE_ART_DIRECTOR_LLM !== "off"`. In CI the OpenAI key is unset → `isAiConfigured` is false → deterministic-only → tests stay hermetic. Tests that exercise the LLM path mock `../../lib/openai` to export `isAiConfigured: true`.
- **Image gen is fire-and-forget** on all paths except `recipe-chat`. Do not add awaited latency to user-facing request handlers.
- TDD: write the failing test first for every code unit that has one (Tasks 1–5, 8's pure helpers). DRY, YAGNI, frequent commits.

## Deviation from spec (flagged for awareness)

Spec Section 5 step 4 specified a new `image_backfill_log` DB table for resume-idempotency. This plan instead uses a **local JSON checkpoint file** (Task 8), because: (a) overwrite-in-place is already idempotent at the R2-key level, (b) the spec's own scale note says ~25 recipes / don't over-build, and (c) it avoids a prod schema migration entirely. If the catalogue grows large post-launch, promote the checkpoint to a DB table. **The feature touches zero DB schema.**

---

## File Structure

**Create:**

- `server/services/image-art-direction.ts` — the engine: types, style library, `selectDeterministicArtDirection`, `subjectFor`, `composePrompt`, `resolveArtDirection`, `buildImagePrompt`.
- `server/services/__tests__/image-art-direction.test.ts` — engine tests.
- `server/lib/recipe-image-keys.ts` — pure URL classifier/key helpers (importable without script side effects).
- `server/lib/__tests__/recipe-image-keys.test.ts` — classifier tests.
- `server/scripts/preview-art-direction.ts` — local eyeball batch generator.
- `server/scripts/backfill-recipe-images.ts` — run-once overwrite-in-place backfill.

**Modify:**

- `server/services/recipe-generation.ts` — `generateRecipeImage` + `generateAndPatchRecipeImage` take `RecipeImageContext`; use `buildImagePrompt`.
- `server/services/canonical-enrichment.ts` — `IMAGE_SHOTS` → variant list; `generateSingleImage`/`generateCanonicalImages` take context; build ctx in `enrichRecipe`.
- `server/routes/meal-plan.ts:284`, `server/routes/recipe-import.ts:206`, `server/routes/recipes.ts:251`, `server/services/recipe-chat.ts:442`, `server/scripts/seed-recipes.ts:308` — pass `RecipeImageContext`.
- `server/services/__tests__/recipe-generation.test.ts`, `server/services/__tests__/canonical-enrichment.test.ts` — update for new signatures.
- `package.json` — add `preview:art-direction`, `backfill:recipe-images` scripts.
- `CLAUDE.md` — document `IMAGE_ART_DIRECTOR_LLM` env var + the two scripts.

---

## Task 1: Art-direction engine — types + deterministic selection

**Files:**

- Create: `server/services/image-art-direction.ts`
- Test: `server/services/__tests__/image-art-direction.test.ts`

**Interfaces:**

- Produces: `ImageVariant = "hero" | "plated" | "ingredients"`; `interface RecipeImageContext { title: string; productName?: string; cuisine?: string | null; mealTypes?: string[] | null; ingredients?: string[] }`; `interface ArtDirection { angle: string; surface: string; background: string; lighting: string; palette: string; props: string; mood: string; season?: string }`; `selectDeterministicArtDirection(ctx: RecipeImageContext, variant: ImageVariant): ArtDirection`.

- [ ] **Step 1: Write the failing test**

```ts
// server/services/__tests__/image-art-direction.test.ts
import { describe, it, expect } from "vitest";
import {
  selectDeterministicArtDirection,
  type RecipeImageContext,
} from "../image-art-direction";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/image-art-direction.test.ts`
Expected: FAIL — `Cannot find module '../image-art-direction'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/services/image-art-direction.ts
import crypto from "node:crypto";

export type ImageVariant = "hero" | "plated" | "ingredients";

export interface RecipeImageContext {
  title: string;
  productName?: string;
  cuisine?: string | null;
  mealTypes?: string[] | null;
  ingredients?: string[];
}

export interface ArtDirection {
  angle: string;
  surface: string;
  background: string;
  lighting: string;
  palette: string;
  props: string;
  mood: string;
  season?: string;
}

interface CuisineStyle {
  palette: string[];
  surfaces: string[];
  props: string[];
  backgrounds: string[];
}

// Each entry holds SETS, not single values, so two recipes of the same cuisine
// don't collide — the per-recipe seed picks a different member.
const CUISINE_STYLES: Record<string, CuisineStyle> = {
  italian: {
    palette: [
      "warm reds and terracotta",
      "rustic earth tones",
      "olive and cream",
    ],
    surfaces: [
      "a warm rustic walnut board",
      "a weathered marble slab",
      "a linen-draped table",
    ],
    props: [
      "a linen napkin and olive oil cruet",
      "fresh basil and a parmesan wedge",
      "a glass of red wine, softly blurred",
    ],
    backgrounds: [
      "a soft blurred trattoria interior",
      "warm out-of-focus kitchen depth",
      "a sunlit stone wall, blurred",
    ],
  },
  mexican: {
    palette: [
      "vibrant reds, limes and warm yellows",
      "earthy chili tones",
      "bright festive colours",
    ],
    surfaces: [
      "a hand-painted terracotta tile",
      "a rough wooden table",
      "a woven textile runner",
    ],
    props: [
      "lime wedges and fresh cilantro",
      "a small bowl of salsa",
      "dried chilies, softly blurred",
    ],
    backgrounds: [
      "warm adobe-toned negative space",
      "a blurred rustic cantina",
      "bright airy depth",
    ],
  },
  japanese: {
    palette: [
      "cool greens and charcoal",
      "muted minimal neutrals",
      "indigo and stone",
    ],
    surfaces: [
      "honed black slate",
      "pale natural light wood",
      "a textured ceramic mat",
    ],
    props: [
      "chopsticks and a ceramic teacup",
      "a sprig of shiso",
      "a small dipping dish",
    ],
    backgrounds: [
      "clean minimal grey depth",
      "soft shoji-screen light, blurred",
      "moody dark negative space",
    ],
  },
  indian: {
    palette: [
      "warm saffron and turmeric tones",
      "deep spice reds",
      "earthy golds",
    ],
    surfaces: [
      "a hammered brass platter",
      "a dark carved wood table",
      "a vibrant textile",
    ],
    props: [
      "whole spices and fresh coriander",
      "a small brass bowl",
      "naan, softly blurred",
    ],
    backgrounds: [
      "warm dark spice-toned depth",
      "a blurred market scene",
      "moody golden negative space",
    ],
  },
  thai: {
    palette: [
      "lush greens and chili reds",
      "tropical brights",
      "lemongrass and lime",
    ],
    surfaces: ["a fresh banana leaf", "dark teak wood", "a woven bamboo mat"],
    props: [
      "lime, lemongrass and chili",
      "a sprig of thai basil",
      "a small bowl of jasmine rice",
    ],
    backgrounds: [
      "dark moody tropical depth",
      "blurred lush greenery",
      "warm dim negative space",
    ],
  },
  mediterranean: {
    palette: [
      "sun-bleached blues and whites",
      "olive and lemon tones",
      "warm sandstone",
    ],
    surfaces: [
      "whitewashed weathered wood",
      "a stone tabletop",
      "a ceramic mosaic tile",
    ],
    props: [
      "lemon halves and fresh herbs",
      "a drizzle of olive oil",
      "olives in a small dish",
    ],
    backgrounds: [
      "bright airy coastal depth",
      "a sunlit blurred terrace",
      "soft white negative space",
    ],
  },
  french: {
    palette: [
      "elegant creams and golds",
      "soft butter tones",
      "muted classic neutrals",
    ],
    surfaces: [
      "a polished marble counter",
      "a vintage copper surface",
      "white linen",
    ],
    props: [
      "a sprig of thyme and a butter knife",
      "a glass of white wine, blurred",
      "a folded linen napkin",
    ],
    backgrounds: [
      "soft bistro depth, blurred",
      "elegant muted negative space",
      "warm window light, blurred",
    ],
  },
  chinese: {
    palette: [
      "deep reds and golds",
      "warm soy-glazed tones",
      "rich earthy browns",
    ],
    surfaces: [
      "dark lacquered wood",
      "a bamboo steamer mat",
      "a textured stone slab",
    ],
    props: [
      "chopsticks and a tea bowl",
      "scallions and sesame",
      "a small dish of chili oil",
    ],
    backgrounds: [
      "warm dim restaurant depth",
      "moody dark negative space",
      "blurred bamboo screen",
    ],
  },
  korean: {
    palette: [
      "warm gochujang reds",
      "earthy fermented tones",
      "sesame and scallion greens",
    ],
    surfaces: [
      "a dark stone bowl setting",
      "brushed steel",
      "natural dark wood",
    ],
    props: [
      "banchan dishes, softly blurred",
      "sesame seeds and scallion",
      "metal chopsticks",
    ],
    backgrounds: [
      "moody warm depth",
      "clean dark negative space",
      "a blurred grill setting",
    ],
  },
  "middle eastern": {
    palette: [
      "warm spice and saffron tones",
      "deep jewel reds",
      "earthy golds and greens",
    ],
    surfaces: ["an ornate patterned tile", "a brass tray", "dark carved wood"],
    props: [
      "pomegranate seeds and mint",
      "a small bowl of tahini",
      "warm flatbread, blurred",
    ],
    backgrounds: [
      "warm dim mosaic depth",
      "moody golden negative space",
      "a blurred souk scene",
    ],
  },
  american: {
    palette: [
      "warm comforting tones",
      "bright fresh colours",
      "classic diner reds",
    ],
    surfaces: ["a rustic wooden board", "brushed metal", "a checked cloth"],
    props: [
      "a side of fries, softly blurred",
      "fresh herbs",
      "a cold drink, blurred",
    ],
    backgrounds: [
      "warm casual depth",
      "bright airy negative space",
      "a blurred diner interior",
    ],
  },
  default: {
    palette: [
      "warm natural tones",
      "fresh appetizing colours",
      "soft balanced neutrals",
    ],
    surfaces: [
      "a warm rustic wooden board",
      "a clean light marble slab",
      "a textured ceramic surface",
    ],
    props: [
      "fresh herbs and a linen napkin",
      "complementary garnish",
      "a simple side, softly blurred",
    ],
    backgrounds: [
      "soft blurred kitchen depth",
      "bright airy negative space",
      "warm out-of-focus background",
    ],
  },
};

const ANGLES: Record<ImageVariant, string[]> = {
  hero: [
    "an overhead flat-lay shot",
    "a 45-degree three-quarter angle",
    "a low hero angle",
  ],
  plated: [
    "an eye-level straight-on shot",
    "a 45-degree three-quarter close-up",
    "a macro close-up",
  ],
  ingredients: ["an overhead flat-lay", "a neat 45-degree flat-lay"],
};

const MEAL_LIGHTING: Record<string, string> = {
  breakfast: "bright morning window light",
  brunch: "bright late-morning light",
  lunch: "soft midday daylight",
  dinner: "warm golden-hour evening glow",
  dessert: "soft diffused light",
  snack: "soft diffused daylight",
};
const DEFAULT_LIGHTING = "soft diffused daylight";

const MOODS = [
  "cozy and rustic",
  "clean and editorial",
  "vibrant and fresh",
  "warm and inviting",
];

function pickIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  const digest = crypto.createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % modulo;
}

function pick<T>(arr: T[], seed: string, salt: string): T {
  return arr[pickIndex(`${seed}::${salt}`, arr.length)];
}

function normalizeCuisineKey(cuisine?: string | null): string {
  if (!cuisine) return "default";
  const key = cuisine.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CUISINE_STYLES, key)
    ? key
    : "default";
}

function lightingForMealTypes(mealTypes?: string[] | null): string {
  for (const mt of mealTypes ?? []) {
    const k = mt.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MEAL_LIGHTING, k))
      return MEAL_LIGHTING[k];
  }
  return DEFAULT_LIGHTING;
}

export function selectDeterministicArtDirection(
  ctx: RecipeImageContext,
  variant: ImageVariant,
): ArtDirection {
  // Seed on title (stable, always present; recipeId is not in the context —
  // recipe-chat generates before a DB id exists, so title is the uniform seed).
  const seed = `${ctx.title}|${variant}`;
  const style = CUISINE_STYLES[normalizeCuisineKey(ctx.cuisine)];
  return {
    angle: pick(ANGLES[variant], seed, "angle"),
    surface: pick(style.surfaces, seed, "surface"),
    background: pick(style.backgrounds, seed, "background"),
    palette: pick(style.palette, seed, "palette"),
    props: pick(style.props, seed, "props"),
    lighting: lightingForMealTypes(ctx.mealTypes),
    mood: pick(MOODS, seed, "mood"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/image-art-direction.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/image-art-direction.ts server/services/__tests__/image-art-direction.test.ts
git commit -m "feat(images): deterministic art-direction style library"
```

---

## Task 2: Subject framing + positive-only prompt composition

**Files:**

- Modify: `server/services/image-art-direction.ts`
- Test: `server/services/__tests__/image-art-direction.test.ts`

**Interfaces:**

- Consumes: `RecipeImageContext`, `ImageVariant`, `ArtDirection` (Task 1).
- Produces: `subjectFor(ctx: RecipeImageContext, variant: ImageVariant): string`; `composePrompt(subject: string, art: ArtDirection): string`.

- [ ] **Step 1: Write the failing test (append to the same test file)**

```ts
import {
  subjectFor,
  composePrompt,
  type ArtDirection,
} from "../image-art-direction";

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/image-art-direction.test.ts`
Expected: FAIL — `subjectFor`/`composePrompt` not exported.

- [ ] **Step 3: Write minimal implementation (append to `image-art-direction.ts`)**

```ts
import { sanitizeUserInput } from "../lib/ai-safety";

const HOUSE_STYLE_PREFIX = "Premium editorial food photography of";
const HOUSE_STYLE_SUFFIX =
  "Photorealistic, appetizing, natural food textures, intentional composition, professional color grading, shallow depth of field where appropriate.";

export function subjectFor(
  ctx: RecipeImageContext,
  variant: ImageVariant,
): string {
  const title = sanitizeUserInput(ctx.title);
  if (variant === "ingredients") {
    return `the raw ingredients for "${title}", neatly arranged`;
  }
  const made = ctx.productName
    ? ` made with ${sanitizeUserInput(ctx.productName)}`
    : "";
  return `a beautifully plated serving of "${title}"${made}`;
}

export function composePrompt(subject: string, art: ArtDirection): string {
  const seasonClause = art.season ? `, ${art.season} seasonal feel` : "";
  return [
    `${HOUSE_STYLE_PREFIX} ${subject}.`,
    `Shot as ${art.angle} under ${art.lighting}.`,
    `Presented on ${art.surface} against ${art.background}.`,
    `Styled with ${art.props}; ${art.palette} colour palette; ${art.mood} mood${seasonClause}.`,
    HOUSE_STYLE_SUFFIX,
  ].join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/image-art-direction.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/image-art-direction.ts server/services/__tests__/image-art-direction.test.ts
git commit -m "feat(images): positive-only prompt composition + subject framing"
```

---

## Task 3: LLM art-director pre-pass + `buildImagePrompt`

**Files:**

- Modify: `server/services/image-art-direction.ts`
- Test: `server/services/__tests__/image-art-direction.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–2; `openai`, `MODEL_FAST`, `isAiConfigured`, `OPENAI_TIMEOUT_FAST_MS` from `../lib/openai`; `sanitizeUserInput`, `SYSTEM_PROMPT_BOUNDARY` from `../lib/ai-safety`.
- Produces: `isArtDirectorLLMEnabled(): boolean`; `resolveArtDirection(ctx, variant, opts?: { skipLLM?: boolean }): Promise<ArtDirection>`; `buildImagePrompt(ctx, variant, opts?: { skipLLM?: boolean }): Promise<string>`.

- [ ] **Step 1: Write the failing test (new mocks at top of the test file)**

> NOTE: these `vi.mock` calls must be at the TOP of the test file (Vitest hoists them). If Tasks 1–2 already run without mocks, move them above the existing `import` of the module under test.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import {
  resolveArtDirection,
  buildImagePrompt,
  selectDeterministicArtDirection,
} from "../image-art-direction";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/image-art-direction.test.ts`
Expected: FAIL — `resolveArtDirection`/`buildImagePrompt` not exported.

- [ ] **Step 3: Write minimal implementation (append to `image-art-direction.ts`)**

```ts
import { z } from "zod";
import {
  openai,
  MODEL_FAST,
  isAiConfigured,
  OPENAI_TIMEOUT_FAST_MS,
} from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("image-art-direction");

const ArtDirectionLLMSchema = z.object({
  angle: z.string().min(1).max(60),
  surface: z.string().min(1).max(80),
  background: z.string().min(1).max(80),
  lighting: z.string().min(1).max(80),
  palette: z.string().min(1).max(80),
  props: z.string().min(1).max(100),
  mood: z.string().min(1).max(60),
  season: z.string().max(40).optional(),
});

function sanitizeField(s: string): string {
  return s
    .replace(/[\r\n"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isArtDirectorLLMEnabled(): boolean {
  return isAiConfigured && process.env.IMAGE_ART_DIRECTOR_LLM !== "off";
}

export async function resolveArtDirection(
  ctx: RecipeImageContext,
  variant: ImageVariant,
  opts?: { skipLLM?: boolean },
): Promise<ArtDirection> {
  const deterministic = selectDeterministicArtDirection(ctx, variant);
  if (opts?.skipLLM || !isArtDirectorLLMEnabled()) return deterministic;

  try {
    const safeTitle = sanitizeUserInput(ctx.title);
    const safeCuisine = ctx.cuisine
      ? sanitizeUserInput(ctx.cuisine)
      : "unspecified";
    const safeMeals =
      (ctx.mealTypes ?? []).map(sanitizeUserInput).join(", ") || "unspecified";
    const safeIngredients =
      (ctx.ingredients ?? []).slice(0, 12).map(sanitizeUserInput).join(", ") ||
      "unspecified";

    const systemPrompt =
      `You are a professional food-photography art director. Propose art direction that makes a dish look like a premium editorial food photo — NOT a generic plain-white-background stock image. Tailor angle, surface, background, lighting, palette, props, mood, and season to the dish, its cuisine, and when it is eaten.\n` +
      SYSTEM_PROMPT_BOUNDARY;

    const userPrompt =
      `Dish: "${safeTitle}"\n` +
      `Cuisine: ${safeCuisine}\n` +
      `Meal types: ${safeMeals}\n` +
      `Key ingredients: ${safeIngredients}\n` +
      `Shot type: ${variant}\n\n` +
      `Refine (do not ignore) this starting point: ${JSON.stringify(deterministic)}\n\n` +
      `Return a JSON object with short-phrase string fields: angle, surface, background, lighting, palette, props, mood, and optionally season. Describe only the scene. Do NOT mention text, captions, logos, or watermarks.`;

    const completion = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 300,
        response_format: { type: "json_object" },
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return deterministic;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return deterministic;
    }

    const validated = ArtDirectionLLMSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn(
        { issues: validated.error.issues },
        "art-director LLM response failed validation; using deterministic",
      );
      return deterministic;
    }

    const d = validated.data;
    return {
      angle: sanitizeField(d.angle),
      surface: sanitizeField(d.surface),
      background: sanitizeField(d.background),
      lighting: sanitizeField(d.lighting),
      palette: sanitizeField(d.palette),
      props: sanitizeField(d.props),
      mood: sanitizeField(d.mood),
      season: d.season ? sanitizeField(d.season) : undefined,
    };
  } catch (err) {
    log.warn(
      { err: toError(err) },
      "art-director LLM call failed; using deterministic",
    );
    return deterministic;
  }
}

export async function buildImagePrompt(
  ctx: RecipeImageContext,
  variant: ImageVariant,
  opts?: { skipLLM?: boolean },
): Promise<string> {
  const art = await resolveArtDirection(ctx, variant, opts);
  return composePrompt(subjectFor(ctx, variant), art);
}
```

> The `import { sanitizeUserInput } from "../lib/ai-safety";` added in Task 2 already covers `sanitizeUserInput`; here we add `SYSTEM_PROMPT_BOUNDARY` to that import. Consolidate into a single import line to satisfy lint.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/image-art-direction.test.ts`
Expected: PASS (all engine tests).

- [ ] **Step 5: Run lint + types on the new module**

Run: `npx eslint server/services/image-art-direction.ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/services/image-art-direction.ts server/services/__tests__/image-art-direction.test.ts
git commit -m "feat(images): LLM art-director pre-pass with deterministic fallback"
```

---

## Task 4: Rewire `recipe-generation.ts` to the engine

**Files:**

- Modify: `server/services/recipe-generation.ts` (`generateRecipeImage` ~303-353; `generateAndPatchRecipeImage` ~371-387)
- Test: `server/services/__tests__/recipe-generation.test.ts`

**Interfaces:**

- Consumes: `buildImagePrompt`, `RecipeImageContext` (Task 3).
- Produces: `generateRecipeImage(ctx: RecipeImageContext, opts?: { skipLLM?: boolean }): Promise<string | null>`; `generateAndPatchRecipeImage(recipeId: number, ctx: RecipeImageContext): Promise<void>`.

- [ ] **Step 1: Update the failing test first**

Open `server/services/__tests__/recipe-generation.test.ts`, find the `generateRecipeImage` describe block, and change call sites from positional strings to a context object. Add a positive-prompt assertion:

```ts
// was: await generateRecipeImage("Pasta", "tomatoes")
const url = await generateRecipeImage(
  {
    title: "Pasta",
    productName: "tomatoes",
    cuisine: "Italian",
    mealTypes: ["dinner"],
  },
  { skipLLM: true },
);
// assert the Runware mock received a positive prompt with NO negative terms:
const promptArg = runware.generateImage.mock.calls[0][0].prompt;
expect(promptArg).toMatch(/editorial food photography/i);
expect(promptArg).not.toMatch(/no text|watermark/i);
```

> If the existing test file mocks `../image-art-direction`, instead mock it to pass through `buildImagePrompt` or leave it unmocked (the engine is deterministic with `skipLLM: true`). Prefer leaving it unmocked and passing `{ skipLLM: true }` so the real composed prompt is asserted.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/recipe-generation.test.ts`
Expected: FAIL — signature mismatch / prompt assertion.

- [ ] **Step 3: Implement the new signature**

Replace `generateRecipeImage` body (keep the Runware-then-DALL-E structure; only the prompt source + signature change):

```ts
import {
  buildImagePrompt,
  type RecipeImageContext,
} from "./image-art-direction";

export async function generateRecipeImage(
  ctx: RecipeImageContext,
  opts?: { skipLLM?: boolean },
): Promise<string | null> {
  const prompt = await buildImagePrompt(ctx, "hero", opts);

  if (isRunwareConfigured) {
    try {
      const buffer = await runwareGenerateImage({ prompt });
      if (buffer) return await saveRecipeImage(buffer);
      log.warn("Runware returned no image, falling back to DALL-E");
    } catch (error) {
      log.warn(
        { err: toError(error) },
        "Runware failed, falling back to DALL-E",
      );
    }
  }

  try {
    // DALL-E has no separate negative field — the exclusions ride as a suffix
    // (this is the DALL-E negative channel; composePrompt stays positive-only).
    const dallePrompt = `${prompt} No text, no watermarks, no logos, no labels, no letters.`;
    const response = await dalleClient.images.generate(
      {
        model: "dall-e-3",
        prompt: dallePrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "b64_json",
      },
      { timeout: OPENAI_TIMEOUT_IMAGE_MS },
    );
    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      log.error("DALL-E returned no image data");
      return null;
    }
    return await saveRecipeImage(Buffer.from(imageData, "base64"));
  } catch (error) {
    log.error({ err: toError(error) }, "DALL-E image generation error");
    return null;
  }
}
```

Update `generateAndPatchRecipeImage`:

```ts
export async function generateAndPatchRecipeImage(
  recipeId: number,
  ctx: RecipeImageContext,
): Promise<void> {
  try {
    const imageUrl = await generateRecipeImage(ctx);
    if (imageUrl) {
      await storage.updateCommunityRecipeImageUrl(recipeId, imageUrl);
    }
  } catch (error) {
    log.error(
      { err: toError(error), recipeId },
      "background image generation failed",
    );
  }
}
```

> Remove the now-unused `sanitizeUserInput` import from this file ONLY if no other code in it uses it (TypeScript/lint will flag if you remove one that's still needed).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/recipe-generation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/recipe-generation.ts server/services/__tests__/recipe-generation.test.ts
git commit -m "refactor(images): generateRecipeImage takes RecipeImageContext via the art-direction engine"
```

---

## Task 5: Rewire `canonical-enrichment.ts` (3-shot) to the engine

**Files:**

- Modify: `server/services/canonical-enrichment.ts` (`IMAGE_SHOTS` ~122-138; `generateSingleImage` ~140-193; `generateCanonicalImages` ~200-207; `enrichRecipe` ~363-364)
- Test: `server/services/__tests__/canonical-enrichment.test.ts`

**Interfaces:**

- Consumes: `buildImagePrompt`, `ImageVariant`, `RecipeImageContext` (Task 3).
- Produces: `generateSingleImage(ctx: RecipeImageContext, variant: ImageVariant): Promise<string | null>`; `generateCanonicalImages(ctx: RecipeImageContext): Promise<string[]>`.

- [ ] **Step 1: Update the test first**

In `canonical-enrichment.test.ts`, the image tests currently exercise `IMAGE_SHOTS`/`generateSingleImage(title, shot)`. Update any direct calls to `generateSingleImage(ctx, variant)` form, e.g.:

```ts
const url = await generateSingleImage(
  { title: "Carbonara", cuisine: "Italian", mealTypes: ["dinner"] },
  "hero",
);
```

If the test asserts on the Runware prompt, assert it is a composed editorial prompt and contains no negative terms (same pattern as Task 4). The enrichRecipe test still mocks `storage.getRecipeById` to return a recipe with `title`, `cuisineOrigin`, `mealTypes`, `ingredients` — ensure the factory (`createMockCommunityRecipe`) provides those (it should; add overrides if needed).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/canonical-enrichment.test.ts`
Expected: FAIL — signature mismatch.

- [ ] **Step 3: Implement**

Replace the `IMAGE_SHOTS` const + `generateSingleImage` + `generateCanonicalImages` region:

```ts
import {
  buildImagePrompt,
  type ImageVariant,
  type RecipeImageContext,
} from "./image-art-direction";

const CANONICAL_VARIANTS: ImageVariant[] = ["hero", "plated", "ingredients"];

async function generateSingleImage(
  ctx: RecipeImageContext,
  variant: ImageVariant,
): Promise<string | null> {
  const prompt = await buildImagePrompt(ctx, variant); // LLM on for HQ canonical

  if (isRunwareConfigured) {
    try {
      const buffer = await generateImage({ prompt, model: RUNWARE_MODEL_HQ });
      if (buffer) return await saveImageBuffer(buffer);
      log.warn(
        { variant },
        "Runware returned no image, falling back to DALL-E",
      );
    } catch (err) {
      log.warn(
        { err: toError(err), variant },
        "Runware failed, falling back to DALL-E",
      );
    }
  }

  try {
    const dallePrompt = `${prompt} No text, no watermarks, no logos, no labels, no letters.`;
    const response = await dalleClient.images.generate(
      {
        model: "dall-e-3",
        prompt: dallePrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "b64_json",
      },
      { timeout: OPENAI_TIMEOUT_IMAGE_MS },
    );
    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      log.error({ variant }, "DALL-E returned no image data");
      return null;
    }
    return await saveImageBuffer(Buffer.from(imageData, "base64"));
  } catch (err) {
    log.error({ err: toError(err), variant }, "DALL-E image generation error");
    return null;
  }
}

async function generateCanonicalImages(
  ctx: RecipeImageContext,
): Promise<string[]> {
  const urls: string[] = [];
  for (const variant of CANONICAL_VARIANTS) {
    const url = await generateSingleImage(ctx, variant);
    if (url) urls.push(url);
  }
  return urls;
}
```

In `enrichRecipe`, build the context from the fetched recipe (Step replaces `generateCanonicalImages(recipe.title)`):

```ts
const imageContext: RecipeImageContext = {
  title: recipe.title,
  cuisine: recipe.cuisineOrigin,
  mealTypes: recipe.mealTypes,
  ingredients: (recipe.ingredients ?? []).map((i) => i.name),
};
const canonicalImages = await generateCanonicalImages(imageContext);
```

> Delete the old `sanitizeUserInput` usage that was only for the removed `IMAGE_SHOTS` prompt path if now unused (the editorial-content path still uses it — keep the import).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/canonical-enrichment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/canonical-enrichment.ts server/services/__tests__/canonical-enrichment.test.ts
git commit -m "refactor(images): canonical 3-shot uses the art-direction engine per variant"
```

---

## Task 6: Thread `RecipeImageContext` through all call sites

**Files:**

- Modify: `server/routes/meal-plan.ts:284`, `server/routes/recipe-import.ts:206`, `server/routes/recipes.ts:251`, `server/services/recipe-chat.ts:442`, `server/scripts/seed-recipes.ts:308`

**Interfaces:**

- Consumes: `generateRecipeImage(ctx, opts?)`, `generateAndPatchRecipeImage(recipeId, ctx)` (Tasks 4).

- [ ] **Step 1: Update `meal-plan.ts:284`**

```ts
const imageUrl = await generateRecipeImage({
  title: recipe.title,
  cuisine: recipe.cuisine,
  mealTypes: recipe.mealTypes,
});
```

- [ ] **Step 2: Update `recipe-import.ts:206`**

```ts
const imageUrl = await generateRecipeImage({
  title: recipe.title,
  cuisine: recipe.cuisine,
  mealTypes: recipe.mealTypes,
});
```

- [ ] **Step 3: Update `recipes.ts:251`** (community recipe → `cuisineOrigin`)

```ts
generateAndPatchRecipeImage(recipe.id, {
  title: generatedRecipe.title,
  productName,
  cuisine: recipe.cuisineOrigin,
  mealTypes: recipe.mealTypes,
}),
```

- [ ] **Step 4: Update `recipe-chat.ts:442`** (deterministic-only — `skipLLM`)

```ts
generateRecipeImage(
  {
    title: recipe.title,
    ingredients: recipe.ingredients.map((i) => i.name),
  },
  { skipLLM: true },
),
```

- [ ] **Step 5: Update `seed-recipes.ts:308`** (cheap/fast — `skipLLM`)

```ts
const imageUrl = await generateRecipeImage(
  { title, productName: ingredient },
  { skipLLM: true },
);
```

- [ ] **Step 6: Verify types compile (catches any wrong column name)**

Run: `npx tsc --noEmit`
Expected: no errors. If a property like `recipe.cuisine` doesn't exist on a community recipe row, TypeScript errors here — switch to `cuisineOrigin` (or vice-versa per the table).

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run server/routes/__tests__/meal-plan.test.ts server/routes/__tests__/recipe-import.test.ts server/routes/__tests__/recipes.test.ts server/services/__tests__/recipe-chat.test.ts`
Expected: PASS. Update any test that called the old positional signature or asserted on `recipe.title, recipe.title`.

- [ ] **Step 8: Commit**

```bash
git add server/routes/meal-plan.ts server/routes/recipe-import.ts server/routes/recipes.ts server/services/recipe-chat.ts server/scripts/seed-recipes.ts server/routes/__tests__ server/services/__tests__/recipe-chat.test.ts
git commit -m "refactor(images): thread RecipeImageContext through all image call sites"
```

---

## Task 7: `preview-art-direction.ts` eyeball script + npm script

**Files:**

- Create: `server/scripts/preview-art-direction.ts`
- Modify: `package.json` (scripts)

**Interfaces:**

- Consumes: `buildImagePrompt` (Task 3); `generateImage`, `isRunwareConfigured` from `../lib/runware`.

- [ ] **Step 1: Write the script**

```ts
/* eslint-disable no-console */
/**
 * Generate a sample batch of art-directed recipe images for visual review.
 * Writes PNGs to scratch/art-direction-preview/ so you can eyeball variety
 * BEFORE running the catalogue backfill.
 *
 * Usage:
 *   npx tsx server/scripts/preview-art-direction.ts            # LLM on (if configured)
 *   npx tsx server/scripts/preview-art-direction.ts --no-llm   # deterministic only
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  buildImagePrompt,
  type RecipeImageContext,
} from "../services/image-art-direction";
import { generateImage, isRunwareConfigured } from "../lib/runware";

const SKIP_LLM = process.argv.includes("--no-llm");
const OUT_DIR = path.resolve(process.cwd(), "scratch", "art-direction-preview");

const SAMPLES: RecipeImageContext[] = [
  { title: "Spaghetti Carbonara", cuisine: "Italian", mealTypes: ["dinner"] },
  { title: "Avocado Toast", cuisine: "American", mealTypes: ["breakfast"] },
  { title: "Chicken Tikka Masala", cuisine: "Indian", mealTypes: ["dinner"] },
  { title: "Pad Thai", cuisine: "Thai", mealTypes: ["lunch"] },
  { title: "Miso Salmon", cuisine: "Japanese", mealTypes: ["dinner"] },
  { title: "Street Tacos", cuisine: "Mexican", mealTypes: ["lunch"] },
  { title: "Tiramisu", cuisine: "Italian", mealTypes: ["dessert"] },
  { title: "Shakshuka", cuisine: "Middle Eastern", mealTypes: ["breakfast"] },
];

async function main() {
  if (!isRunwareConfigured) {
    console.error("RUNWARE_API_KEY not set — cannot generate preview images.");
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `Generating ${SAMPLES.length} preview images (LLM ${SKIP_LLM ? "OFF" : "ON"}) → ${OUT_DIR}`,
  );
  for (const [i, ctx] of SAMPLES.entries()) {
    const prompt = await buildImagePrompt(ctx, "hero", { skipLLM: SKIP_LLM });
    console.log(`\n[${i + 1}] ${ctx.title}\n    ${prompt}`);
    const buffer = await generateImage({ prompt });
    if (!buffer) {
      console.warn(`    (no image returned)`);
      continue;
    }
    const slug = ctx.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const file = path.join(
      OUT_DIR,
      `${String(i + 1).padStart(2, "0")}-${slug}.png`,
    );
    fs.writeFileSync(file, buffer);
    console.log(`    → ${file}`);
  }
  console.log("\nDone. Open the folder and eyeball the variety.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, after `"migrate:images-r2": ...`, add:

```json
"preview:art-direction": "tsx server/scripts/preview-art-direction.ts",
```

- [ ] **Step 3: Smoke-test compile (no real generation needed for the gate)**

Run: `npx tsc --noEmit`
Expected: no errors. (Actual image generation is a manual eyeball step in rollout, not a CI gate.)

- [ ] **Step 4: Commit**

```bash
git add server/scripts/preview-art-direction.ts package.json
git commit -m "feat(images): art-direction preview batch script"
```

---

## Task 8: `backfill-recipe-images.ts` — overwrite-in-place, run-once

**Files:**

- Create: `server/lib/recipe-image-keys.ts`, `server/lib/__tests__/recipe-image-keys.test.ts`, `server/scripts/backfill-recipe-images.ts`
- Modify: `package.json` (scripts)

**Interfaces:**

- Produces: `classifyRecipeImageUrl(url: string | null | undefined, r2PublicBase: string | null): "ours" | "external" | "none"`; `deriveRecipeImageFilename(url: string): string | null`.

- [ ] **Step 1: Write the failing test for the pure helpers**

```ts
// server/lib/__tests__/recipe-image-keys.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyRecipeImageUrl,
  deriveRecipeImageFilename,
} from "../recipe-image-keys";

const BASE = "https://cdn.ocrecipes.app";

describe("classifyRecipeImageUrl", () => {
  it("classifies our R2 recipe images as 'ours'", () => {
    expect(
      classifyRecipeImageUrl(`${BASE}/recipe-images/recipe-abc.png`, BASE),
    ).toBe("ours");
  });
  it("classifies our dev disk recipe images as 'ours'", () => {
    expect(
      classifyRecipeImageUrl("/api/recipe-images/recipe-abc.png", BASE),
    ).toBe("ours");
  });
  it("classifies external photos as 'external'", () => {
    expect(classifyRecipeImageUrl("https://spoonacular.com/x.jpg", BASE)).toBe(
      "external",
    );
  });
  it("classifies null as 'none'", () => {
    expect(classifyRecipeImageUrl(null, BASE)).toBe("none");
  });
  it("does not match avatars (wrong prefix)", () => {
    expect(classifyRecipeImageUrl(`${BASE}/avatars/x.png`, BASE)).toBe(
      "external",
    );
  });
});

describe("deriveRecipeImageFilename", () => {
  it("extracts the filename from an R2 url", () => {
    expect(
      deriveRecipeImageFilename(`${BASE}/recipe-images/recipe-abc.png`),
    ).toBe("recipe-abc.png");
  });
  it("extracts the filename from a disk url", () => {
    expect(deriveRecipeImageFilename("/api/recipe-images/recipe-abc.png")).toBe(
      "recipe-abc.png",
    );
  });
  it("returns null when not a recipe-images url", () => {
    expect(
      deriveRecipeImageFilename("https://spoonacular.com/x.jpg"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/__tests__/recipe-image-keys.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helpers**

```ts
// server/lib/recipe-image-keys.ts
/** Classify a stored recipe image URL by ownership for the backfill. */
export function classifyRecipeImageUrl(
  url: string | null | undefined,
  r2PublicBase: string | null,
): "ours" | "external" | "none" {
  if (!url) return "none";
  if (r2PublicBase) {
    const base = r2PublicBase.replace(/\/$/, "");
    if (url.startsWith(`${base}/recipe-images/`)) return "ours";
  }
  if (url.startsWith("/api/recipe-images/")) return "ours";
  return "external";
}

/** Extract the single-segment filename of an our-bucket recipe image URL. */
export function deriveRecipeImageFilename(url: string): string | null {
  const m = url.match(/\/recipe-images\/([A-Za-z0-9._-]+)$/);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/lib/__tests__/recipe-image-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the backfill script**

```ts
/* eslint-disable no-console */
/**
 * Run-once backfill: re-generate our OWN AI recipe images in place with the new
 * art direction. Overwrites the existing R2 object at its current key (DB URL
 * unchanged). Skips external source photos and (by default) null images.
 *
 * Idempotent resume via a local JSON checkpoint (recipe keys already done).
 *
 * Usage:
 *   npx tsx server/scripts/backfill-recipe-images.ts --dry-run     # classify + sample, no spend
 *   npx tsx server/scripts/backfill-recipe-images.ts --limit 5     # smoke test
 *   npx tsx server/scripts/backfill-recipe-images.ts               # full run (hero images)
 *   npx tsx server/scripts/backfill-recipe-images.ts --include-canonical  # also canonicalImages[]
 *   npx tsx server/scripts/backfill-recipe-images.ts --fill-missing       # also generate for null-image rows
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import { communityRecipes, mealPlanRecipes } from "@shared/schema";
import { generateImage, isRunwareConfigured } from "../lib/runware";
import { saveRecipeImage } from "../lib/image-store";
import {
  buildImagePrompt,
  type RecipeImageContext,
} from "../services/image-art-direction";
import {
  classifyRecipeImageUrl,
  deriveRecipeImageFilename,
} from "../lib/recipe-image-keys";

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_CANONICAL = process.argv.includes("--include-canonical");
const FILL_MISSING = process.argv.includes("--fill-missing");
const limitFlag = process.argv.indexOf("--limit");
const LIMIT = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : Infinity;
const R2_BASE = process.env.R2_PUBLIC_BASE_URL ?? null;
const CHECKPOINT = path.resolve(
  process.cwd(),
  "scratch",
  "backfill-recipe-images.checkpoint.json",
);

function loadCheckpoint(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function saveCheckpoint(done: Set<string>): void {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, JSON.stringify([...done]));
}

/** Re-generate one image and overwrite the existing R2 key in place. */
async function refreshInPlace(
  existingUrl: string,
  ctx: RecipeImageContext,
  variant: "hero" | "plated" | "ingredients",
): Promise<boolean> {
  const filename = deriveRecipeImageFilename(existingUrl);
  if (!filename) return false;
  const prompt = await buildImagePrompt(ctx, variant);
  const buffer = await generateImage({ prompt });
  if (!buffer) return false;
  const ext = (filename.split(".").pop() ?? "png").toLowerCase();
  await saveRecipeImage(
    buffer,
    ext === "jpg" || ext === "jpeg" || ext === "webp"
      ? (ext as "jpg" | "jpeg" | "webp")
      : "png",
    filename,
  );
  return true;
}

async function main() {
  console.log(`=== Backfill recipe images ${DRY_RUN ? "(dry-run)" : ""} ===`);
  if (!DRY_RUN && !isRunwareConfigured) {
    throw new Error("RUNWARE_API_KEY not set — image generation unavailable.");
  }
  const done = loadCheckpoint();
  const counts = {
    ours: 0,
    external: 0,
    none: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
  };

  // Community recipes carry both the hero imageUrl and canonicalImages[].
  const community = await db
    .select({
      id: communityRecipes.id,
      imageUrl: communityRecipes.imageUrl,
      canonicalImages: communityRecipes.canonicalImages,
      cuisineOrigin: communityRecipes.cuisineOrigin,
      mealTypes: communityRecipes.mealTypes,
      title: communityRecipes.title,
    })
    .from(communityRecipes);
  const mealPlan = await db
    .select({
      id: mealPlanRecipes.id,
      imageUrl: mealPlanRecipes.imageUrl,
      cuisine: mealPlanRecipes.cuisine,
      mealTypes: mealPlanRecipes.mealTypes,
      title: mealPlanRecipes.title,
    })
    .from(mealPlanRecipes);

  let processed = 0;
  for (const r of community) {
    if (processed >= LIMIT) break;
    const ctx: RecipeImageContext = {
      title: r.title,
      cuisine: r.cuisineOrigin,
      mealTypes: r.mealTypes,
    };
    const key = `community:${r.id}:hero`;
    const cls = classifyRecipeImageUrl(r.imageUrl, R2_BASE);
    counts[cls]++;
    if (cls === "ours" && !done.has(key)) {
      processed++;
      if (DRY_RUN) {
        console.log(`[dry] community ${r.id} hero -> ${r.imageUrl}`);
      } else {
        try {
          const ok = await refreshInPlace(r.imageUrl!, ctx, "hero");
          if (ok) {
            counts.refreshed++;
            done.add(key);
            saveCheckpoint(done);
            console.log(`community ${r.id} hero refreshed`);
          } else counts.failed++;
        } catch (e) {
          counts.failed++;
          console.error(`community ${r.id} hero FAILED:`, e);
        }
      }
    } else if (cls === "ours") counts.skipped++;

    if (INCLUDE_CANONICAL && Array.isArray(r.canonicalImages)) {
      const variants: ("hero" | "plated" | "ingredients")[] = [
        "hero",
        "plated",
        "ingredients",
      ];
      for (let i = 0; i < r.canonicalImages.length && processed < LIMIT; i++) {
        const url = r.canonicalImages[i];
        const ckey = `community:${r.id}:canonical:${i}`;
        if (classifyRecipeImageUrl(url, R2_BASE) !== "ours" || done.has(ckey))
          continue;
        processed++;
        if (DRY_RUN) {
          console.log(`[dry] community ${r.id} canonical[${i}] -> ${url}`);
          continue;
        }
        try {
          const ok = await refreshInPlace(url, ctx, variants[i] ?? "plated");
          if (ok) {
            counts.refreshed++;
            done.add(ckey);
            saveCheckpoint(done);
          } else counts.failed++;
        } catch (e) {
          counts.failed++;
          console.error(`community ${r.id} canonical[${i}] FAILED:`, e);
        }
      }
    }
  }

  for (const r of mealPlan) {
    if (processed >= LIMIT) break;
    const ctx: RecipeImageContext = {
      title: r.title,
      cuisine: r.cuisine,
      mealTypes: r.mealTypes,
    };
    const key = `mealplan:${r.id}:hero`;
    const cls = classifyRecipeImageUrl(r.imageUrl, R2_BASE);
    counts[cls]++;
    if (cls === "ours" && !done.has(key)) {
      processed++;
      if (DRY_RUN) {
        console.log(`[dry] mealplan ${r.id} -> ${r.imageUrl}`);
      } else {
        try {
          const ok = await refreshInPlace(r.imageUrl!, ctx, "hero");
          if (ok) {
            counts.refreshed++;
            done.add(key);
            saveCheckpoint(done);
            console.log(`mealplan ${r.id} refreshed`);
          } else counts.failed++;
        } catch (e) {
          counts.failed++;
          console.error(`mealplan ${r.id} FAILED:`, e);
        }
      }
    } else if (cls === "ours") counts.skipped++;
    // FILL_MISSING (cls === "none") intentionally not implemented in this minimal
    // pass — flag reserved; the ~25-row catalogue has no null AI images to fill.
  }

  console.log(
    `\n=== Done. classified ours=${counts.ours} external=${counts.external} none=${counts.none}; refreshed=${counts.refreshed} skipped(checkpoint)=${counts.skipped} failed=${counts.failed} ===`,
  );
  if (!DRY_RUN)
    console.log(
      "Next: purge the Cloudflare cache for recipe-images/* so the CDN serves the new bytes.",
    );
  await pool.end();
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  void pool.end().then(() => process.exit(1));
});
```

> `--fill-missing` is parsed but intentionally a no-op in this minimal pass (documented inline). If you want it active, add a `cls === "none"` branch that calls `generateRecipeImage(ctx)` and writes the new URL back via `db.update`. Keep it out unless needed (YAGNI for ~25 rows).

- [ ] **Step 6: Add the npm script**

In `package.json`, after `preview:art-direction`, add:

```json
"backfill:recipe-images": "tsx server/scripts/backfill-recipe-images.ts",
```

- [ ] **Step 7: Verify compile + helper tests**

Run: `npx tsc --noEmit && npx vitest run server/lib/__tests__/recipe-image-keys.test.ts`
Expected: no type errors; helper tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/lib/recipe-image-keys.ts server/lib/__tests__/recipe-image-keys.test.ts server/scripts/backfill-recipe-images.ts package.json
git commit -m "feat(images): run-once overwrite-in-place backfill (ours-only, checkpointed)"
```

---

## Task 9: Documentation

**Files:**

- Modify: `CLAUDE.md` (Environment Variables; Development Commands)

> Note: per project memory, `CLAUDE.md` is gitignored/untracked — this edit is local-only and won't appear in `git status`. Make it anyway for the local working doc.

- [ ] **Step 1: Add the env var**

In `CLAUDE.md` → Environment Variables, add to the core/AI list:

```
`IMAGE_ART_DIRECTOR_LLM` (set to `off` to disable the per-image LLM art-director pre-pass; defaults on when OpenAI is configured. Deterministic style library still runs.)
```

- [ ] **Step 2: Add the commands**

In `CLAUDE.md` → Development Commands, near the seed section:

```bash
# Recipe image art direction
npm run preview:art-direction            # generate a sample batch to scratch/ for eyeballing (LLM on)
npm run preview:art-direction -- --no-llm
npm run backfill:recipe-images -- --dry-run   # classify existing images, no spend
npm run backfill:recipe-images -- --limit 5   # smoke test
npm run backfill:recipe-images                # refresh our AI hero images in place
# then purge the Cloudflare cache for recipe-images/* so the CDN serves new bytes
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document IMAGE_ART_DIRECTOR_LLM + art-direction scripts" || echo "CLAUDE.md is gitignored — local only, nothing to commit"
```

---

## Final verification (after all tasks)

- [ ] Run the full preflight gate (CLAUDE.md: required before opening a PR):

Run: `npm run preflight`
Expected: lint + types + tests + coverage all pass.

- [ ] Manual acceptance (the real test of the original complaint):

```bash
npm run preview:art-direction          # LLM on
npm run preview:art-direction -- --no-llm
# Open scratch/art-direction-preview/ and confirm the images no longer feel
# samey / white-background-slop, and the LLM-on set adds season/mood relevance.
```

- [ ] When satisfied, run the backfill: `--dry-run` → `--limit 5` → full run → Cloudflare cache purge for `recipe-images/*`.

## Self-review checklist (completed by plan author)

- **Spec coverage:** Section 1 → Tasks 1–3 (engine). Section 2 → Tasks 1–2 (style library, house style). Section 3 → Task 3 (LLM, fallback, injection firewall, env gating). Section 4 → Tasks 4–6 (threading, per-table cuisine column). Section 5 → Task 8 (overwrite-in-place, 3-category classify, checkpoint resume [deviation: file not table], dry-run breakdown). Section 6 → Tasks 1–3 tests + Task 7 preview + Final verification (corpus-variety assertion, not pairwise). ✅
- **Placeholders:** none — every code step has real code; `--fill-missing` no-op is documented, not a TODO.
- **Type consistency:** `RecipeImageContext`, `ArtDirection`, `ImageVariant` names match across Tasks 1–8; `generateRecipeImage(ctx, opts?)` / `generateAndPatchRecipeImage(recipeId, ctx)` signatures consistent between Task 4 (definition) and Task 6 (callers); `classifyRecipeImageUrl`/`deriveRecipeImageFilename` match between Task 8 definition and the backfill script.
