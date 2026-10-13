# Paste-Text Recipe Import + Normalize-All-Imports

**Date:** 2026-07-13
**Status:** Approved design, pending implementation plan

## Problem

Two related gaps in the recipe-import flow:

1. **Clipboard import is image-only.** `ImportRecipeSheet`'s "Paste from Clipboard" option (`client/components/meal-plan/ImportRecipeSheet.tsx:202-239`, `handleClipboard`) checks only `Clipboard.hasImageAsync()`. A user who copies recipe text (from a note, a message, a site that blocks scraping) has no way to import it — URL import only works on scrapable pages, and there's no "paste text" option anywhere in the app.

2. **Normalization isn't universally applied.** `normalizeRecipeFields` (`server/lib/recipe-normalization.ts`) standardizes title casing, description punctuation, difficulty labels, instruction step-prefixes, and ingredient units — but it's called ad hoc from three separate route files, not from one guaranteed choke point. Concretely:
   - **`updateMealPlanRecipe`** (`server/storage/meal-plan-recipes-crud.ts:216-265`) never normalizes at all — editing a recipe's title/description/difficulty bypasses normalization entirely.
   - **Catalog "Browse recipes" save** (`server/routes/recipe-catalog.ts:166-241`) saves Spoonacular-shaped data straight into the DB with zero normalization, ever.
   - Every other import path (URL, camera, gallery, clipboard-image, AI-generate) _does_ get normalized by the time the wizard's final Save fires — but only because each route remembers to call `normalizeRecipeFields` manually before persisting. Nothing structurally prevents a future import path from forgetting, which is exactly how the catalog-save gap happened.

## Scope boundary

This design does **not** touch the approved-but-unimplemented camera-import redesign (`docs/superpowers/specs/2026-06-30-recipe-import-redesign-design.md`) beyond reusing one already-decided piece of it (see "Backend" under Part 1). Multi-photo capture, `photoUris[]`, the OCR-first completeness-gate rewrite of `RecipePhotoImportScreen`'s existing photo/vision gate, and `needsEnhance` are all out of scope here — that redesign's Phase 2 remains stalled (confirmed: zero references to `structureRecipeFromText`, `photoUris`, or `needsEnhance` anywhere in the codebase) and unaffected by this work.

## Part 1: Paste-text import

### Client — smart auto-detect on the existing clipboard option

`handleClipboard` (`ImportRecipeSheet.tsx:202-239`) gains a text branch: if `Clipboard.hasImageAsync()` is false, check `Clipboard.hasStringAsync()` → `Clipboard.getStringAsync()`. No new option tile — "Paste from Clipboard" handles both, matching how paste behaves everywhere else on the OS. Neither found → existing empty-clipboard error, generalized to "Clipboard is empty."

**Premium-gating restructure required:** today the entire `handleClipboard` call is wrapped by `handlePremiumAction`/`usePremiumFeature("recipePhotoImport")` at the option-dispatch level (the `handlers` map, `clipboard: { premium: true, ... }`). Since gating now depends on clipboard _content_ (image → still gated; text → free, see below), the check has to move inside `handleClipboard` itself, after content-type detection: the image branch keeps the existing premium check (unchanged behavior); the text branch skips it entirely.

This is not just an internal-logic change: `handlers.clipboard.premium = true` (`ImportRecipeSheet.tsx:250`) also drives a **static** UI/a11y state independent of the runtime check — `isLocked = row.premium && !canImportPhoto` (`:278`) renders a lock icon and an accessibility label of `"${row.title}, premium feature"` on the tile itself, before any tap, based purely on the flag. Once gating depends on clipboard content, that static flag is simply wrong — a free user with text on their clipboard would see a "Paste from Clipboard, premium feature" locked tile that actually works for free once tapped. The fix is to drop `premium: true` from the `clipboard` entry entirely (tile always renders unlocked); the real paywall still fires correctly at tap-time via `handlePremiumAction` inside the image branch, showing `UpgradeModal` reactively — same pattern the app already uses elsewhere for gating that can't be known upfront. (Eagerly reading clipboard content on sheet-open to compute an accurate per-content lock icon was considered and rejected: reading the clipboard triggers an OS-level "app pasted from clipboard" notification on iOS/Android, so probing it just to decide icon state before the user has chosen to paste is a real UX cost, not a free option.)

### Gating decision: free, rate-limited

Paste-text is **not** premium-gated. This follows the app's own prior decision (2026-06-30 redesign spec) that text-structuring is the free tier and vision is the paid differentiator — pasted text never invokes vision at all, so gating it the same way as photo import would rest on a premise (equivalent AI cost) the app's own design already rejected. Abuse control is `photoRateLimit` + input sanitization + a length cap, not a paywall (see Backend below) — these are mandatory per `docs/rules/api.md`/`docs/rules/security.md` for any AI endpoint, gated or not.

### Backend — reuse the stalled plan's already-decided shape

Rather than inventing a new service/schema, build the one piece of the parked Phase 2 plan that paste-text actually needs, using its already-decided names, location, and constraints:

- **`structureRecipeFromText(pageTexts: string[]): Promise<RecipePhotoResult>`** — new function in `server/services/photo-analysis.ts` (same file as `analyzeRecipePhoto`), a plain text-only OpenAI JSON-mode call (no vision/image encoding — cheaper and faster than the photo path). Reuses the existing `recipePhotoResultSchema` and `parseVisionResponse` helper unchanged — no new schema, no rename, no relocation (keeps this file consistent with what the parked Phase 2 plan already assumes lives here — its "one schema, do not add a second one" constraint applies).
- **`POST /api/photos/structure-recipe`** — new route in `server/routes/photos.ts`, alongside the other photo/recipe AI routes. Takes `{ pageTexts: string[] }`. Paste-text always sends a single-element array (`[pastedText]`) — the array shape is what the plan specifies so a future OCR-first multi-page camera flow can reuse this same endpoint without a signature change.
- **Not premium-gated.** Protected by `photoRateLimit` (`server/routes/_rate-limiters.ts`, already applied to all four existing photo routes) applied before the handler.
- **Input sanitization:** each page text runs through `sanitizeUserInput` (`server/lib/ai-safety.ts:54`) and goes into a **user**-role message only, never system — pasted text is fully adversarial-controlled (anyone can paste anything, including prompt-injection attempts).
- **Length cap:** each page text capped at 4000 characters server-side via Zod (matches the parked plan's number) — over-cap input is rejected with a 400, never silently truncated. No existing schema covers this shape (`{ pageTexts: string[] }` with a per-item cap) — a new Zod schema is authored fresh alongside the route, not adapted from an existing one.

### Screen architecture

`RecipePhotoImportScreen.tsx` already has the right shape (auto-trigger on mount, `analyzing → review → error` state machine, "Recipe Extracted" review card, `handleSave` → `navigation.replace("RecipeCreate", { prefill })`). Rather than duplicating it:

- Extract the state machine into a small reusable hook — `useRecipeExtractionFlow(mutationFn, gateCheck)` — parameterized on (a) the mutation to run and (b) how to decide analyzing→review vs. analyzing→error. This lets each screen keep its own gating rule without duplicating the analyzing/review/error/accessibility-announcement plumbing.
  - `RecipePhotoImportScreen` keeps its existing gate unchanged: `confidence > 0.3 && title` (not touched — that gate rewrite is Phase 2 scope, deliberately left alone here).
  - New `RecipeTextImportScreen` uses a **completeness** gate instead: `!!title && ingredients.length > 0 && !!instructions?.length`. A non-vision text-structuring call doesn't produce a meaningful confidence score (the same reasoning the parked plan already worked out for its OCR-first text path), so completeness is the more honest signal here.
- Extract the "Recipe Extracted" review card into a shared presentational component (title/servings/macros/ingredient-preview/"Review & Save" button) — same UI for both screens, taking `result: RecipePhotoResult` as a prop. This is the concrete "uniform look and feel" lever for this half of the feature.
- Error copy branches by source: "Try a clearer photo" (photo) vs. "Try pasting the full recipe, including ingredients and instructions" (text). Both keep the existing "Import from URL" fallback button.
- `sourceUrl` sentinel for the mapped `ImportedRecipeData`: `"text_import"` (parallel to the existing `"photo_import"`).
- New mapping function `mapTextResultToImportedRecipeData` mirrors `mapPhotoResultToImportedRecipeData` (`client/lib/photo-upload.ts:411-433`) — same transforms (split `instructions` on `\n`, macro fields to strings), different `sourceUrl` sentinel, `imageUrl: null`.
- New route `RecipeTextImport: { pastedText: string; returnToMealPlan?: {...}; fromHome?: boolean }` registered alongside `RecipePhotoImport` in `client/navigation/MealPlanStackNavigator.tsx`.

## Part 2: Centralize normalization at the storage write layer

Moves the `normalizeRecipeFields` call from being sprinkled across routes into the shared DB-write functions themselves, so it's structurally guaranteed rather than dependent on each route remembering.

- **`createMealPlanRecipe`** (`server/storage/meal-plan-recipes-crud.ts:94-133`) — normalize `title`/`description`/`difficulty`/`instructions` (from `recipe`) and `ingredients` at the top of the function, **before** `deriveRecipeAllergens` runs (preserves today's ordering, where allergen matching already sees normalized ingredient names).
- **`updateMealPlanRecipe`** (lines 216-265) — currently never normalizes. Add the same call, scoped to the three editable fields it covers (`title`, `description`, `difficulty` — `instructions`/`ingredients` aren't editable via this endpoint today).

  `RecipeFieldsInput.title`/`NormalizedRecipeFields.title` change from required to optional — but the type change alone is not sufficient. `normalizeRecipeFields` currently does `title: normalizeTitle(data.title)` unconditionally, unlike `description`/`difficulty`/`instructions`/`ingredients`, which all already use an `"x" in data` presence guard (`recipe-normalization.ts:197-217`) before touching the field. `normalizeTitle` itself unconditionally `.trim()`s its argument, so an absent `title` (a real case — `updateMealPlanRecipe`'s `Partial<UpdatableMealPlanRecipeFields>` genuinely allows a difficulty-only edit) would either fail to typecheck or throw at runtime once the type goes optional without the matching body change. Fix: give `title` the exact same `"title" in data` conditional treatment as the other four fields. For every existing create-path caller this is a no-op (a create always supplies a title, since it's `notNull()` on both `mealPlanRecipes` and `communityRecipes`) — only partial-update callers are affected, which is exactly the case this fix exists for.

- **`createRecipeWithLimitCheck`** (`server/storage/community-recipes.ts:87-138`, the AI-generate persist path) — same treatment as `createMealPlanRecipe`. Its sibling `createCommunityRecipe` (lines 64-80) is used only by the dev seed script (verified: only caller is `server/scripts/seed-recipes.ts`) — left untouched, since seed data isn't user-imported and is presumably already curated.
- **Cleanup — remove now-redundant pre-persist calls:** `meal-plan.ts:236`, `recipe-import.ts:152`, `recipes.ts:187`.
- **Explicitly kept — not redundant:** `recipe-import.ts:72`, the URL-parse **preview** endpoint. It returns data straight to the client for wizard display and never touches storage; removing it would regress URL-import's preview from normalized back to raw text.
- **Side effect, confirmed desired:** because `createMealPlanRecipe` is also what "write a recipe from scratch" calls, hand-typed recipes get normalized too, not just imports.
- **Automatic side effect:** catalog "Browse recipes" save, which calls `storage.createMealPlanRecipe` directly today with zero normalization, is fixed for free — no route-level change needed there.

### Required fix: fraction-quantity conversion

`recipeIngredients.quantity` is a nullable `decimal(10,2)` column. `normalizeIngredient` today only `.trim()`s the quantity string — never converting `"1/2"` into something the column accepts. This is pre-existing exposure for URL/photo import today, but paste-text turns it from an edge case into a near-certainty (pasted recipes constantly use fraction quantities like "1/2 cup flour").

**The fix must not live inside the shared `normalizeIngredient`/`normalizeRecipeFields` functions as a blanket "unrecognized → null" rule.** `normalizeRecipeFields` is a single pure function reused by both `createMealPlanRecipe`/`updateMealPlanRecipe` (writing `recipeIngredients.quantity`, a nullable `decimal`) and `createRecipeWithLimitCheck` (writing `communityRecipes.ingredients`, a `jsonb` column typed `{name: string; quantity: string; unit: string}[]` and marked `.notNull()` — confirmed at `shared/schema.ts:614-617`). A blanket null-fallback inside the shared function would violate the second consumer's non-nullable `string` element type, and — worse — silently discard legitimate freeform quantity text ("a pinch," "to taste") that the JSONB column has always tolerated as-is with zero format constraint. This is the general shape of the risk with reusing a single-shape pure function across consumers whose target schemas differ: the abstraction is only safe once every consumer's schema is checked to tolerate the same output, and here they don't.

Fix, split by responsibility:

- Port the existing client-only `fractionToDecimal` (`client/lib/ingredient-parser.ts:11-32`) into a new shared `shared/lib/quantity.ts` (alongside the existing `shared/lib/units.ts`) as `normalizeQuantityToDecimal(raw: string): string | null` — a pure conversion attempt: recognizes integers, decimals, simple fractions, mixed numbers, and unicode glyphs ("½"), returns the decimal-string form, or `null` if the input isn't a recognized numeric format.
- **`normalizeIngredient`'s own output contract is unchanged** (`quantity: string`, never `null`) — it uses the new helper as `normalizeQuantityToDecimal(trimmed) ?? trimmed`: convert when recognized, otherwise keep the original trimmed text exactly as today. This is safe for _both_ consumers unmodified — `communityRecipes`' non-nullable JSONB string column never sees anything it didn't already tolerate, and freeform quantity text is never dropped for that path.
- **The nullable-decimal-specific coercion happens only in `createMealPlanRecipe`**, as a caller-local step after calling `normalizeRecipeFields` — this is exactly the "callers retain their own post-normalization fallback policy" contract `normalizeRecipeFields`'s own docstring already documents, not a new pattern. For each ingredient, if `quantity` doesn't match a clean numeric string (e.g. `/^\d+(\.\d+)?$/` — it's already gone through `normalizeQuantityToDecimal` by this point, so anything still non-numeric is freeform text like "a pinch" that genuinely has nowhere valid to go in a `decimal` column), coerce it to `null` immediately before the insert. `updateMealPlanRecipe` needs no equivalent step: confirmed it never writes `recipeIngredients` at all — `UpdatableMealPlanRecipeFields` omits `ingredients` (meal-plan ingredients are immutable after creation, per the existing comment at `meal-plan-recipes-crud.ts:221-226`), so its normalization fix (above) is title/description/difficulty only. `createRecipeWithLimitCheck` also needs no equivalent step — `normalizeIngredient`'s output is already valid for its column as-is.

No client-side follow-on change is needed here: `ImportedRecipeData.ingredients[].quantity` is already typed `string | null` (`shared/types/recipe-import.ts`, unrelated to this change — the photo-import schema has always allowed a null quantity), so `formToPayload` already tolerates `null` today. This fix is entirely server-side, at the last step before each affected insert/update.

## Error handling

- Empty clipboard (no image, no text): existing-style error toast, generalized copy.
- Low-quality/garbage pasted text: completeness gate routes to the error state with retry + "Import from URL" fallback — same UX pattern as photo's low-confidence path.
- Rate limiting / OpenAI failures: reuses the existing `importErrorCopy` `ApiError.code` mapping (`PREMIUM_REQUIRED`, `VALIDATION_ERROR`, `RATE_LIMITED`, generic) — already source-agnostic, no changes needed.
- Prompt-injection in pasted text (e.g. "ignore previous instructions and...") — sanitized via `sanitizeUserInput`, placed in a user-role message only, never obeyed or allowed to break structuring.

## File-touch surface

**New files:**

- `client/screens/meal-plan/RecipeTextImportScreen.tsx`
- `client/hooks/useRecipeExtractionFlow.ts` (shared state-machine hook)
- `client/components/meal-plan/RecipeExtractionReviewCard.tsx` (shared review-card UI, extracted from `RecipePhotoImportScreen`)
- `shared/lib/quantity.ts` (fraction→decimal conversion, shared client/server)

**Modified:**

- `client/components/meal-plan/ImportRecipeSheet.tsx` — `handleClipboard` content-type branching, premium-gating restructure
- `client/screens/meal-plan/RecipePhotoImportScreen.tsx` — refactored onto the shared hook/component
- `client/lib/photo-upload.ts` — new `mapTextResultToImportedRecipeData`
- `client/lib/ingredient-parser.ts` — `fractionToDecimal` moves to `shared/lib/quantity.ts` (or re-exports from there)
- `client/navigation/MealPlanStackNavigator.tsx` — new `RecipeTextImport` route + param type
- `server/services/photo-analysis.ts` — new `structureRecipeFromText`
- `server/routes/photos.ts` — new `POST /api/photos/structure-recipe`
- `server/lib/recipe-normalization.ts` — `RecipeFieldsInput.title` becomes optional
- `server/storage/meal-plan-recipes-crud.ts` — `createMealPlanRecipe`, `updateMealPlanRecipe`
- `server/storage/community-recipes.ts` — `createRecipeWithLimitCheck`
- `server/routes/meal-plan.ts`, `server/routes/recipe-import.ts`, `server/routes/recipes.ts` — remove redundant pre-persist `normalizeRecipeFields` calls (keep `recipe-import.ts:72`)

## Testing

- Server: `structureRecipeFromText` unit tests (mocked OpenAI); route tests for `POST /api/photos/structure-recipe` (rate-limit path, length-cap rejection, no premium gate, prompt-injection input doesn't reach a system message); unit tests confirming `createMealPlanRecipe`/`updateMealPlanRecipe`/`createRecipeWithLimitCheck` normalize before persisting (including the allergen-derivation-sees-normalized-names ordering); unit tests for `normalizeQuantityToDecimal` (simple fractions, mixed numbers, unicode glyphs, unrecognized text → `null`). Two cases specifically targeting the fixes above:
  - `updateMealPlanRecipe` with a title-omitting partial update (e.g. difficulty-only) — asserts it normalizes the fields present without throwing on the absent title.
  - `createRecipeWithLimitCheck` with an unrecognized freeform quantity string (e.g. "a pinch") — asserts the original text is preserved unchanged in the persisted `communityRecipes.ingredients` JSONB, not dropped or nulled.
- Client: `handleClipboard` content-type branching (image priority, text fallback, empty-clipboard error, conditional premium gate); `useRecipeExtractionFlow` with both gate functions; `RecipeTextImportScreen` state transitions; `RecipeExtractionReviewCard` rendering.
- `npm run preflight` before opening the implementation PR, per project convention.

## Out of scope

- Camera-import redesign Phase 2 (multi-photo capture, `photoUris[]`, OCR-first completeness-gate rewrite of `RecipePhotoImportScreen`'s existing vision gate, `needsEnhance`) — remains stalled, untouched by this work beyond reusing `structureRecipeFromText`'s shape.
- Expanding `normalizeRecipeFields`'s field coverage (servings, times, cuisine, dietTags, nutrition rounding, imageUrl validation) — out of scope; this design only guarantees the _existing_ five-field normalization is applied everywhere, not that it covers more fields.
- Community-recipe editing — no general edit function exists for `communityRecipes` today (only `isPublic` toggle and an internal image-URL patcher); nothing to normalize-on-edit there.
