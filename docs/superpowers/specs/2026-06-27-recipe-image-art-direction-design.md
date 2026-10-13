# Recipe Image Art Direction — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending spec review → implementation plan
**Author:** Claude (brainstorming session with @xertox1234)

## Problem

Every AI-generated recipe image looks identical: the same overhead 45° angle, the
same plain white/minimalist background, the same neutral ceramic plate. The image
quality is fine for the price, but the uniformity makes the app feel like "AI slop."
The cause is structural — the art direction (angle, surface, background, lighting,
props, palette) is hardcoded as string literals in the prompt, identical for every
dish regardless of cuisine, meal type, or season.

Two prompt-builders share this problem:

1. `server/services/recipe-generation.ts` → `generateRecipeImage(recipeTitle, productName)`
   — one hero prompt, fixed _"Overhead 45-degree angle … Clean minimalist background,
   photorealistic."_ This is the main user-facing path (recipe creation, meal-plan,
   recipe-import, recipe-chat, seed).
2. `server/services/canonical-enrichment.ts` → a 3-shot array (hero / plated /
   ingredients) for curated/canonical recipes, also hardcoded angles and white/marble
   backgrounds.

`generateRecipeImage()` only receives `recipeTitle` + `productName` today — the
recipe's `cuisine`, `mealTypes`, and `dietTags` (which exist in the schema) are not
passed in, so no context-aware art direction is possible without threading them.

Image generation is fire-and-forget background work on **most** paths (meal-plan,
recipe-import, `generateAndPatchRecipeImage`), so a small pre-pass adds zero user-facing
latency there. **One exception:** `recipe-chat.ts:441-447` _awaits_ `generateRecipeImage`
inside a `Promise.race` with a 15s timeout and yields the image before `done` — that path
is user-visible and already races Runware's 5–30s. The LLM stylist must **not** run there
(see Section 3); the chat path stays deterministic-only.

## Goals

- Kill the "every image is the same angle + white background" sameness.
- Make art direction **relevant to the dish**: cuisine palette/props/surface,
  time-of-day from meal type, and (via LLM) season + per-dish mood.
- Maintain a coherent **editorial house style** — varied within it, never slop,
  always on-brand.
- Refresh the **existing** catalogue too, once, safely.

## Non-goals (YAGNI)

- No caching of art direction (images generate once per recipe).
- No new image infrastructure — `runware.ts` and `image-store.ts` are unchanged at
  runtime.
- No schema columns on recipe tables (overwrite-in-place backfill removes the need).
- No auto-regeneration on deploy (explicitly rejected — too costly/destructive).

## Decisions (from brainstorming)

| Decision  | Choice                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| Scope     | Both paths — user-facing heroes **and** canonical 3-shot                      |
| Mechanism | Hybrid — deterministic rules base **+** optional LLM stylist with fallback    |
| Aesthetic | Editorial house style, strong variety within it                               |
| Backfill  | Run-once, idempotent, user-triggered; **overwrite-in-place** on Cloudflare R2 |

---

## Section 1 — Architecture & module boundaries

One new module owns all art direction; both image paths consume it.

```
                  server/services/image-art-direction.ts   ← NEW (the brain)
                  ├─ types: RecipeImageContext, ArtDirection
                  ├─ STYLE LIBRARY (cuisine→palette/surface/props, mealType→lighting,
                  │                 angle rotation)
                  ├─ selectDeterministicArtDirection(ctx, variant) → ArtDirection  (pure, sync)
                  ├─ composePrompt(subject, artDirection)          → string         (pure)
                  └─ resolveArtDirection(ctx, variant)             → Promise<ArtDirection>
                       └─ tries LLM stylist → validates (Zod) → falls back to deterministic
                                │
             ┌──────────────────┴───────────────────┐
   recipe-generation.ts                     canonical-enrichment.ts
   generateRecipeImage(ctx)                  3 shots (hero/plated/ingredients)
   (single hero, STANDARD model)             (HQ model) — each shot = a "variant"
             └──────────────┬───────────────────────┘
                            ▼
                lib/runware.ts generateImage()   (transport, unchanged)
                            ▼
                lib/image-store.ts saveRecipeImage()  (unchanged at runtime)
```

Boundary decisions:

- The art-direction engine is the **single source of truth for "the look."** Neither
  image path contains prompt literals anymore — they pass a `RecipeImageContext` and a
  _variant_ (hero/plated/ingredients), and receive a finished prompt. This stops the
  two paths from drifting apart again.
- `runware.ts` and `image-store.ts` are **untouched at runtime** — already correctly
  factored as transport/persistence. The change is entirely in _what prompt string_
  flows into them.
- The deterministic core is **pure & synchronous** → unit-testable with zero mocks.
  The async LLM layer wraps it and always degrades to it.

---

## Section 2 — The style library & the editorial house style

The engine produces a structured `ArtDirection`, then composes it into a prompt.
Variety comes from the middle layers; the quality floor comes from a constant wrapper.

```ts
interface ArtDirection {
  angle: string; // "overhead flat-lay" | "45° three-quarter" | "eye-level straight-on"
  //   | "macro close-up" | "low hero angle"
  surface: string; // "warm rustic walnut board" | "honed black slate" | "terracotta tile"
  //   | "linen-draped table" …
  background: string; // "soft blurred kitchen depth" | "moody dark negative space"
  //   | "bright airy marble" …
  lighting: string; // from mealType: "bright morning window light" | "warm golden-hour glow"
  //   | "soft diffused daylight"
  palette: string; // from cuisine: "warm reds & terracotta" | "cool greens & charcoal"
  //   | "earthy spice tones" …
  props: string; // cuisine-appropriate: "linen napkin & olive oil cruet"
  //   | "chopsticks & ceramic teacup" …
  mood: string; // "cozy & rustic" | "clean & editorial" | "vibrant & fresh"
}
```

Three deterministic inputs drive selection:

1. **`cuisine` → palette / surface / props.** A curated map (Italian, Mexican,
   Japanese, Indian, Thai, Mediterranean, French, Chinese, Korean, Middle-Eastern,
   American, + a `default`). Each entry is a **small set** of on-style options, not one
   fixed value (e.g. Japanese → {slate/light-wood surfaces, cool minimal palette,
   chopsticks/ceramic props}).
2. **`mealType` → lighting / time-of-day.** breakfast → bright morning; lunch → midday
   daylight; dinner → warm evening/golden-hour; dessert/snack → soft diffused. This is
   the "time eaten" lever, from data already stored.
3. **A stable variant seed → angle + which option within each set.**
   `hash((recipeId ?? title) + variantLabel)` picks the angle and the specific
   surface/prop/background from the cuisine's set. Same recipe is stable; different
   recipes diverge; the 3 canonical shots each get a different seed so they don't look
   identical. The `recipeId` fallback to `title` matters for `recipe-chat`, which
   generates the image mid-stream **before** a DB id exists — the title keeps the seed
   deterministic there. The single user-facing image uses the `hero` variant label;
   canonical uses `hero` / `plated` / `ingredients`.

**House-style wrapper (the anti-slop guarantee)** — `composePrompt` builds the
**positive prompt only**: a constant prefix/suffix wrapped around the variable middle —

> _"Premium editorial food photography, photorealistic, appetizing, natural food
> textures, intentional composition, professional color grading, shallow depth of field
> where appropriate."_

**The negative prompt is a separate, untouched channel.** Runware takes `negativePrompt`
as its own API field (`runware.ts:68`), and DALL-E gets it as a suffix
(`recipe-generation.ts:329`). Negative terms (`text, watermark, logo … cartoon,
illustration, 3d render`) must **never** be concatenated into the positive prompt —
naming what you don't want inside the positive prompt actively summons it. `composePrompt`
emits positive only; the existing negative channel flows through unchanged.

Rationale:

- **Variety and quality are separated by construction.** The model roams across
  angle/surface/palette/props (variety, in the positive prompt) but is always fenced by
  the constant editorial wrapper (quality floor) and, on the separate negative channel,
  the existing exclusions.
- The cuisine map holds **sets, not single values**, so two Italian dinner recipes
  don't collide — the variant seed picks different members. Without that, you'd trade
  "every dish identical" for "every Italian dish identical."
- The `ingredients` canonical shot stays semantically distinct (flat-lay of raw
  components) but gets the cuisine palette/surface instead of hardcoded white marble,
  so it matches its hero. **The variant selects the subject framing too, not just the
  art direction** — `composePrompt(subject, artDirection)` is called with
  subject = "raw ingredients for X" for the `ingredients` variant vs. "plated X" for
  `hero`/`plated`. So a variant carries both _what is shown_ and _how it's shot_.

Risk: a flat cuisine→style map can feel mechanical if too rigid. Mitigation = the
variant-seed rotation + the LLM layer (Section 3) overriding it for dishes where the
map is too generic. The deterministic layer is the floor, not the ceiling.

---

## Section 3 — The LLM art-director pre-pass

Delivers what pure rules can't: **season** (not stored anywhere) and genuine per-dish
mood ("a Thai green curry shot dark and moody on a banana leaf").

**Critical choice: the LLM returns structured JSON, not a prompt string.**

```ts
const ArtDirectionLLMSchema = z.object({
  angle: z.string().max(60),
  surface: z.string().max(80),
  background: z.string().max(80),
  lighting: z.string().max(80),
  palette: z.string().max(80),
  props: z.string().max(100),
  mood: z.string().max(60),
  season: z.string().max(40).optional(), // the value-add rules can't provide
});
```

Flow inside `resolveArtDirection(ctx, variant)`:

1. Compute the deterministic `ArtDirection` first (always — it's the fallback, and it
   primes the LLM).
2. If the LLM layer is enabled and OpenAI is configured: send the **sanitized** recipe
   context (title, cuisine, mealTypes, key ingredients) + the deterministic pick as a
   starting point; ask for an enriched `ArtDirection` JSON.
3. **Validate against the Zod schema** + sanitize field contents (length caps above,
   strip newlines/quotes/control chars). On _any_ failure — timeout, network, invalid
   JSON, schema miss, disabled flag — **return the deterministic result.** No path
   leaves us without a usable `ArtDirection`.
4. `composePrompt()` renders whichever `ArtDirection` we ended up with into the
   **positive prompt**, always inside the constant house-style wrapper. The negative
   prompt continues to flow through its own separate channel — never concatenated in.

Guardrails (titles are user-controlled — URL scrapes and chat):

- **JSON-not-prose is the injection firewall.** The LLM can only populate typed,
  length-capped descriptive slots; we control the wrapper + negative prompt. A
  malicious title can at most influence an adjective inside one slot — never the prompt
  skeleton — and the negative prompt already suppresses rendered text.
  `sanitizeUserInput()` stays on the inputs regardless.
- The deterministic pick is the prompt seed, so the LLM **refines** a known-good art
  direction rather than inventing from scratch.
- No caching, no new infra. One cheap, low-`max_tokens` call on the existing OpenAI
  client (`server/lib/openai.ts`), on the already-async background path.

Config & defaults:

- Reuses the existing OpenAI client with a small/cheap chat model and a short timeout
  (a few seconds).
- Gated by an env flag `IMAGE_ART_DIRECTOR_LLM` (default **on** in prod when OpenAI is
  configured). **Off (deterministic-only) in tests and by default in the seed script** —
  the test suite stays hermetic and `seed:recipes` stays cheap/fast.
- **Per-path opt-out:** `resolveArtDirection` accepts a `skipLLM` flag so a _latency-
  sensitive_ caller can force deterministic-only regardless of the env flag. The
  `recipe-chat` path passes `skipLLM: true` (it awaits within a 15s race on a premium
  feature — see Problem). All background paths leave it false.

---

## Section 4 — Threading recipe context through the call sites

Replace the positional `(title, productName)` signature with a single context object:

```ts
interface RecipeImageContext {
  title: string;
  productName?: string;     // optional now (callers that lack one don't fake it)
  cuisine?: string | null;
  mealTypes?: string[] | null;
  ingredients?: string[];   // names only; feeds the LLM + ingredient flat-lay shot
}

generateRecipeImage(ctx: RecipeImageContext): Promise<string | null>
generateAndPatchRecipeImage(recipeId, ctx): Promise<void>
```

**The cuisine column name differs per source table** — `community_recipes.cuisineOrigin`
vs `meal_plan_recipes.cuisine` (confirmed in `shared/schema.ts`). `RecipeImageContext`
normalizes to a single `cuisine` field, so each call site must read its table's actual
column. Getting this wrong fails _silently_: a missing column reads `undefined` → the
`default` palette, and the cuisine-awareness never fires for that table's recipes (likely
the bulk, for community). This is a verify-before-wiring item, not an assumption.

Per-call-site updates (5 callers + canonical):

| Call site                                               | Source table → column                                  | Passes after                                       |
| ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `routes/meal-plan.ts:284`                               | `meal_plan_recipes` → `cuisine`, `mealTypes`           | full context                                       |
| `routes/recipe-import.ts:206`                           | `meal_plan_recipes` → `cuisine`, `mealTypes`           | full context                                       |
| `services/recipe-chat.ts:442`                           | generated recipe object → `ingredients`                | title + ingredients, **`skipLLM: true`** (latency) |
| `routes/recipes.ts:251` → `generateAndPatchRecipeImage` | `community_recipes` → **`cuisineOrigin`**, `mealTypes` | title + cuisine + mealTypes                        |
| `scripts/seed-recipes.ts:308`                           | known seed metadata                                    | title + cuisine                                    |

Missing fields degrade gracefully: no `cuisine` → LLM infers from title/ingredients
(where the LLM runs), or the deterministic `default` palette applies. No call site
fabricates data (kills the current `recipe.title, recipe.title` smell). TypeScript flags
every caller, so no silent _signature_ miss — but the column-name mapping above is the
part TypeScript can't catch, so it's called out explicitly.

---

## Section 5 — Run-once idempotent backfill (overwrite-in-place)

New script `server/scripts/backfill-recipe-images.ts`, following existing
`migrate-images-to-r2.ts` / `seed-recipes.ts` conventions.

**Why overwrite-in-place works:** `image-store.ts` `saveRecipeImage()` already exposes a
`filenameOverride` param documented for "one-shot migration scripts ONLY: a
deterministic filename makes re-runs idempotent (same-key PUT overwrites instead of
orphaning the prior object)." We derive the existing R2 key from each recipe's stored
`imageUrl`, then PUT new bytes to that same key. **The DB `imageUrl` never changes** →
no migration, no DB URL rewrites, no orphaned R2 objects.

**Critical: the DB holds a mix of image sources, and the backfill must touch only ours.**
Both `recipe-import.ts` and `meal-plan.ts` gate generation on `if (!recipe.imageUrl)`,
so a recipe imported _with_ a real source photo keeps that **external** URL and never
got an AI image. Three categories result:

- **(A) Our AI images** — URL under the R2 public base + `recipe-images/` (prod) or
  `/api/recipe-images/` (dev disk). **This is the slop to fix — the only category the
  backfill touches.**
- **(B) External source photos** — Spoonacular / URL-import hosts. **Always skipped** —
  these are real photographs and must never be replaced with AI. (A naive
  trailing-filename `filenameOverride` would also write a junk object into our bucket
  while the DB still points off-site — wasted spend, no visible change.)
- **(C) Null / no image** — outside the "refresh existing slop" mandate. **Skipped by
  default**; behind an opt-in `--fill-missing` flag it takes the normal new-key path
  and _does_ update the DB URL.

Steps:

1. **Enumerate & classify** recipes with stored images across the relevant tables
   (community, meal-plan, canonical 3-shot arrays). The enumerator filters to
   **Category A only** — `imageUrl` must start with the R2 public base + `recipe-images/`
   (or `/api/recipe-images/` on disk). Categories B and C are excluded (C unless
   `--fill-missing`).
2. Build a `RecipeImageContext` from each row → art direction → new bytes.
3. **Overwrite in place:** derive the existing key from the row's `imageUrl`, pass it as
   `filenameOverride` to `saveRecipeImage` → same-key PUT, DB pointer unchanged.
4. **Idempotent ledger:** a small **new standalone** `image_backfill_log` table
   (`recipeId`, `recipeType`, `styleVersion`, `refreshedAt`) — polymorphic, matching the
   existing recipeId+recipeType discriminator pattern. This is the one additive schema
   object in the design — a brand-new table with no contract on existing recipe rows, so
   it carries none of the migrate-before-merge risk of altering the hot recipe tables
   (consistent with the "no schema columns on recipe tables" non-goal). The script skips
   rows already at the current `styleVersion`, so interrupt/resume never re-pays. A
   future style bump = increment the version → reprocess.
5. **Throttled & sequential** (one at a time, like `canonical-enrichment`) to avoid
   rate-limit bursts on Runware/DALL-E and R2.
6. **Safety:** dry-run flag reporting the **category breakdown** (A overwrite / B skipped
   external / C skipped null) + sample prompts, no generation — so the blast radius is
   visible before spending; `--limit N` for a test batch; refuses prod without an
   explicit `--allow-prod`-style guard; **does not touch curated/canonical rows unless
   `--include-canonical` is passed** (protects deliberately-approved B2B images).
7. **After the run:** one Cloudflare cache purge — because the URLs are unchanged, the
   CDN edge cache won't otherwise know the bytes changed. This is the single understood
   tradeoff of overwrite-in-place vs. new-key. Note the purge fixes the **CDN edge only**;
   a React Native **on-device** image cache keyed by URL would still serve stale bytes —
   but that's a post-launch concern, since mobile/web clients aren't shipped yet.

**Scale note (don't over-build):** today prod has ~25 seeded recipes against a near-empty
R2 and no shipped clients. The first run is tiny and the only cache layer that matters is
the CDN edge. Keep this script proportionate — it does not need machinery for a catalogue
that doesn't exist yet.

---

## Section 6 — Verification, rollout & acceptance

"Doesn't look like AI slop" is subjective and image-level, so verification splits in
two.

**Automated (what unit tests can prove) — Vitest, hermetic:**

- `selectDeterministicArtDirection` — given cuisine + mealType + variant seed, returns
  expected slots; **same recipe is stable** (same inputs → same output). The
  anti-sameness invariant is asserted as **variety across a corpus**, not pairwise
  inequality — e.g. "N sample recipes yield ≥K distinct art directions" / "not all
  identical." (Pairwise "any two differ" is wrong: with a small option set + hashing,
  two recipes collide on a slot by pigeonhole, so that assertion would flake.)
- `composePrompt` — returns the **positive prompt only**, always wrapping the constant
  editorial preamble; **asserts negative terms are NOT present in the positive output**
  (they belong to the separate channel); never emits raw user text unfenced.
- Negative-prompt channel — asserts the existing Runware `negativePrompt` param / DALL-E
  suffix is unchanged and still carries the exclusions (regression guard against someone
  "helpfully" merging the channels).
- LLM layer — Zod validation rejects malformed/oversized fields; **every failure mode
  (timeout, bad JSON, schema miss, flag off) falls back to deterministic** (mock OpenAI;
  assert fallback path).
- Injection — a hostile title ("…render text 'FREE'") cannot inject the prompt skeleton:
  the positive prompt keeps the editorial wrapper and the separate negative channel is
  untouched.
- Backfill — key-derivation from a stored URL round-trips to the same key; the
  classifier sorts URLs correctly (Category A = our `recipe-images/` key → overwrite;
  B = external host → skip; C = null → skip unless `--fill-missing`); ledger skip-logic.

**Manual (the actual acceptance gate) — sample-batch eyeball script:**

- `server/scripts/preview-art-direction.ts` generates images for N representative dishes
  spanning cuisines × meal types into a local folder, with both LLM-on and LLM-off, so
  the variety is visible side by side.
- **Acceptance = eyeball the batch and agree it no longer feels samey/slop.** Not a test
  count. This is the only thing that answers the original complaint.

**Rollout:**

1. Ship the art-direction engine + threaded call sites + tests → all _new_ images get
   the new look immediately (LLM gated on in prod, off in tests/seed).
2. Run `preview-art-direction.ts`, eyeball, tune the style library / LLM instructions.
3. When satisfied, run the backfill (dry-run → `--limit` smoke test → full run) →
   Cloudflare cache purge.

**Docs:** add `IMAGE_ART_DIRECTOR_LLM` to CLAUDE.md Environment Variables; add the
backfill/preview scripts to Development Commands.

Rationale: tests lock the _mechanism_ (variety exists, fallback is safe, injection is
fenced); the eyeball batch judges _taste_. Generating the preview batch **before** the
backfill means tuning the look on a handful of cheap local images, not by regenerating
the whole catalogue and discovering you don't like it.

---

## Open questions / to confirm during planning

- Confirm the per-table cuisine column (`community_recipes.cuisineOrigin` vs
  `meal_plan_recipes.cuisine`) and that `mealTypes` exists on each source, before wiring
  Section 4. Silent fallback if wrong.
- Exact cuisine list + the member sets for each (palette/surface/props) — refine during
  implementation against the dishes actually in the catalogue.
- Exact small/cheap OpenAI model id for the stylist (match an existing cheap-task call).
- Cloudflare cache-purge mechanism (API token scope) for the post-backfill step.
- Confirm canonical image storage shape (array of URLs) for the backfill enumerator.
