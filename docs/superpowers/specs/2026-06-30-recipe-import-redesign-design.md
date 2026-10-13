# Recipe Import Redesign

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan

## Problem

The stated complaint — "the import recipe screen is just a URL field and an Import button" — turned out to describe one real screen (`RecipeImportScreen`) accurately, but the underlying problem is fragmentation, not absence. The app already has three different "add/import a recipe" UI patterns of varying quality:

| Surface                             | Reached from                                                   | Options offered                                                                             |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `RecipeEntryHubScreen`              | "Create new recipe" in the meal-slot Quick Add sheet           | 5 cards: scratch / AI generate / URL / camera-picker / browse                               |
| `ImportRecipeSheet`                 | A separate "Import Recipe" action on a meal slot               | 4 rows: URL / Camera / Gallery / Clipboard — the best-designed surface, but hardest to find |
| `QuickAddSheet` → "Import from URL" | Meal-slot Quick Add                                            | Bare URL screen only                                                                        |
| Home tab quick-action tile          | Home tab grid                                                  | Bare URL screen only                                                                        |
| Home tab discovery card             | Home tab carousel, headline "Import any recipe from a website" | Bare URL screen only                                                                        |

The best-built flow (`ImportRecipeSheet`, which already supports importing a screenshot straight from the clipboard) is tucked behind a meal-plan action most users won't find. The two most prominent, most-marketed entry points — the Home tab tile and discovery card — dead-end into the barebones URL screen. `RecipeEntryHubScreen` and `ImportRecipeSheet` also disagree with each other on what the import options even are.

Both existing extraction paths (URL scraping via `recipe-import.ts`, and photo extraction via GPT-4V in `photo-analysis.ts`) already converge on the same confluence point: `RecipeCreate`, pre-filled with an `ImportedRecipeData`-shaped draft for the user to review and fix before saving. Confirmed directly: `RecipePhotoImportScreen.handleSave` calls `navigation.replace("RecipeCreate", { prefill, returnToMealPlan })` (same target and shape as the URL path, `RecipePhotoImportScreen.tsx:129`). This redesign builds on that existing seam rather than replacing it.

## Scope boundary

This design covers **importing an existing recipe** — from a URL, a cookbook photo, a screenshot, or a clipboard image. It does not cover **generating a new recipe from photographed ingredients**, which is a separate, already-built, already-premium-gated flow (`RecipeAIGenerate` → `recipe-generation.ts`). The two stay independent.

Also explicitly out of scope for this cycle (see "Out of scope" section): share-sheet import, voice dictation, video/reel import.

## Architecture: consolidation

### The fork

The two well-built surfaces today live at different presentation levels: `RecipeEntryHubScreen` is a pushed full screen (and covers more than import — scratch/AI-generate/browse too), while `ImportRecipeSheet` is a bottom-sheet overlay (used for quick, mid-flow decisions from a meal-plan slot). Both contexts are legitimate; the fix is to stop them from disagreeing about what "import" means, and to stop shortcuts from bypassing both.

### Decision: shared config, thin shell + rewrite

A single source of truth — `recipe-import-options.ts` (mirroring the existing `client/components/home/action-config.ts` pattern) — defines the import options: From URL, From Camera, From Gallery, From Clipboard (id, icon, title, description, handler). No screen or sheet hardcodes this list.

One of the two consuming layers is a thin pass-through; the other is a real rewrite, not just a new prop:

- **`RecipeEntryHubScreen`** — its current two drifting cards ("Import from URL" + "Scan a recipe") collapse into **one** "Import a Recipe" card that opens the same sheet as an overlay. Genuinely thin.
- **`ImportRecipeSheet`** (bottom sheet) — changes on three independent axes, verified against the current implementation:
  1. **Standalone mode.** `plannedDate: string` and the callback signatures `onNavigateUrlImport: (mealType, date) => void` / `onPhotoImport: (uri, mealType, date) => void` (`ImportRecipeSheet.tsx:35-38`) become optional, and every handler's `if (!mealType) return` guard (`:78`, `:98`, and the equivalent in `handleGallery`/`handleClipboard`) needs a no-meal-plan branch that still proceeds.
  2. **Client-side capture gate removed.** `usePremiumFeature("recipePhotoImport")` (`:51`) and the `handlePremiumAction` wrapper (`:84-94`) currently block Camera/Gallery/Clipboard from even opening for free users — this is where "free to try" is actually delivered, not just a server-side flag. The wrapper is removed from the three capture handlers entirely; gating moves to the post-extraction "Enhance with AI vision" action only (see Quality gate below).
  3. **Multi-shot capture**, per Capture flow below.

  Reframing the summary above: this is "shared config, one thin shell + one three-axis rewrite," not "two thin shells."

Rejected alternative: a single universal full-screen import destination everywhere (retiring the bottom sheet). Simpler navigation code, but a real UX regression for the meal-plan flow — bottom sheets are this app's established pattern for "quick decision without leaving the screen" (`QuickAddSheet`, `SimpleEntrySheet`, `ImportRecipeSheet` itself already work well this way). Fixing the Home tab's problem shouldn't come at the cost of breaking a flow that already works.

### Entry point changes

| Entry point                             | Today                                          | After                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home tab quick-action tile              | → bare `RecipeImport`                          | → opens shared sheet (standalone mode)                                                                                                                                               |
| Home tab discovery card                 | → bare `RecipeImport`, copy says "paste a URL" | → opens shared sheet; copy updated to mention photo/clipboard too                                                                                                                    |
| `QuickAddSheet` → "Import from URL" row | → bare `RecipeImport`                          | → dismisses, then opens shared sheet (same sheet-handoff pattern `MealPlanHomeScreen` already uses elsewhere, e.g. `handleImportRecipe`'s `InteractionManager.runAfterInteractions`) |
| Meal-slot "Import Recipe" action        | → `ImportRecipeSheet` (already good)           | → same, gains the enhanced options below                                                                                                                                             |
| Hub's import card(s)                    | → 2 separate cards, direct navigation          | → 1 card, opens shared sheet                                                                                                                                                         |

The sheet's "From URL" row still navigates to `RecipeImportScreen` (its idle/loading/error states and `importRecipeFromUrl` service stay as-is) — the change is that this navigation becomes the screen's _only_ entry point. Every other path that used to jump there directly (Home tile, Home card, `QuickAddSheet`'s row) is repointed at the sheet instead, per the entry-point table above.

## Extraction pipeline

### Capture flow

"From Camera" becomes sequential multi-shot: capture a photo, then a lightweight prompt — "Add another page?" (Add Page / Extract Now) — capped at **3 photos**. "From Gallery" uses `ImagePicker`'s multi-select (`allowsMultipleSelection`, `selectionLimit: 3`) so 2-3 screenshots can be picked in one interaction. "From Clipboard" stays single-image — multi-image clipboard isn't a meaningful interaction.

On-device OCR runs **at capture time**, per photo, immediately after each shot/selection — not lazily when the review screen mounts. This mirrors an existing, shipped precedent: `ReceiptCaptureScreen.tsx` already builds an `ocrTexts: (string | undefined)[]` array alongside its `photos` array as each photo is taken, then navigates with `{ photoUris: photos, ocrTexts: definedOcrTexts.length > 0 ? definedOcrTexts : undefined }` (`RootStackNavigator.tsx:117`: `ReceiptReview: { photoUris: string[]; ocrTexts?: string[] }`). `RecipePhotoImport`'s route params adopt the identical shape — `{ photoUris: string[]; ocrTexts?: string[]; returnToMealPlan?: {...} }` — instead of inventing a new one.

**Deviation from the receipt precedent, stated explicitly:** `ReceiptReviewScreen` triggers its AI/vision scan unconditionally on mount ("Trigger AI scan on mount (races with local preview)" — `ReceiptReviewScreen.tsx:122`), always paying for vision and using `shouldReplaceWithAIReceipt` (`receipt-review-utils.ts:12`) only to decide whether to _display_ the AI result over the local one. Verified correction: this is **not** because receipt scanning is free — `/api/receipt/scan` is premium-gated on `receiptScanner` (`receipt.ts:50-56`) same as recipe photo import is on `recipePhotoImport`. The real reason unconditional vision is fine there is that the gate already runs _before_ any scan starts, so every caller reaching that code is already paying — there's no free tier to protect, so spending on best-quality extraction by default is a reasonable UX choice. Recipes are different specifically because this redesign _removes_ that upfront gate for the OCR-first path — calling vision unconditionally would silently reintroduce a cost on every "free" camera import, defeating the one thing this redesign changes. Vision must stay conditional — only after the completeness gate fails, or on explicit user tap — because of that removed gate, not because of anything about receipts. The shape of the receipt precedent (capture-time OCR, `photoUris`/`ocrTexts` params, a pure compare/decide function) is reused; the always-call-vision behavior is not.

### The extraction matrix

OCR-first and multi-photo interact, so both cells are specified explicitly:

|                               | Single photo                                                   | Multi-photo (2-3)                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OCR-first (free, default)** | On-device MLKit OCR → text-LLM structures the text             | MLKit OCR **each photo independently, on-device** → concatenate texts in capture/selection order with a page marker → **one** text-LLM call structures the combined text |
| **Vision fallback (premium)** | GPT-4V on the one image (today's existing behavior, unchanged) | GPT-4V call with **all N images attached to one request** — `analyzeRecipePhoto` extended to accept an image array instead of a single image                             |

Source (camera/gallery/clipboard) only determines how the photo(s) get onto the device; the extraction pipeline (OCR-first, multi-photo combination, quality gate, vision fallback) is uniform regardless of source.

### Quality gate — and what it actually replaces on `RecipePhotoImportScreen`

Verified against the current implementation, this is a real rewrite of the screen's core logic, not a pass-through: today, `useRecipePhotoImport` (`useRecipePhotoImport.ts`) is a `useMutation<RecipePhotoResult, Error, string>` — hard-typed to a single URI — and the screen gates on `data.confidence > 0.3 && data.title` in **two** places (the initial analyze effect, `RecipePhotoImportScreen.tsx:85`, and `handleTryAgain`, `:139`). Both the hook's input type and the gate itself change.

**Result shape: unified on `RecipePhotoResult`, not branched.** Both the OCR-first and vision paths return the same `RecipePhotoResult` shape the screen's review UI already renders (title, ingredients, instructions, servings, times, macros, `confidence`) — not the narrower `ImportedRecipeData`, which would lose the macro/ingredient-count preview for the OCR-first path. `RecipePhotoResult`'s `confidence` field is populated by the vision path as today; the OCR-first path does not populate it meaningfully (no verified per-page MLKit confidence to source it from — see below), so gating cannot key off it uniformly.

**The gate itself is replaced, not supplemented:** `data.confidence > 0.3 && data.title` is replaced at both call sites with a completeness check — `!!data.title && data.ingredients.length > 0 && !!data.instructions?.length` — that works identically regardless of which path produced the result. `confidence` stops being a gating input; the vision path can keep returning it for now (unused), or it can be dropped from the type later as a smaller follow-up.

**No new state enum.** `state` stays `"analyzing" | "review" | "error"`. `error` is reserved for true failure (OCR found no text at all, or structuring produced no title whatsoever) — the existing empty-state UI already covers this correctly and doesn't change. A low-but-nonzero-quality result (some fields present, some missing) still reaches `review`, same as a good result; the screen additionally derives `needsEnhance` from the same completeness check on the currently-held `result` and conditionally renders an "Enhance with AI vision" button alongside the existing "Review & Save" button when true. Tapping it re-runs the same `photoUris` through the vision path and replaces `result` — `needsEnhance` is then recomputed from the new result, so the button naturally disappears once vision has filled the gaps (no separate "already enhanced" flag needed).

On `needsEnhance`: free users tapping it see the existing `UpgradeModal`, framed as "Enhance with AI vision." Premium users get a plain one-tap retry — no upgrade prompt. Nobody is ever blocked from saving a low-quality _free_ result; "Review & Save" stays available regardless, they can fix gaps by hand in `RecipeCreate` same as today. "Enhance" is always optional.

react-native-ml-kit's per-page confidence reporting has not been verified to exist in a usable form, so it is not used anywhere in this gate. If a usable signal is confirmed during implementation, it can supplement (not replace) the completeness check later.

**Deliberately not built:** a "skip OCR, go straight to vision" shortcut for premium users. Everyone hits OCR-first first, since it's near-instant and usually sufficient; only gate failures pay for a vision call.

## Premium gating

Today: URL import is free; Camera/Gallery/Clipboard are entirely premium-gated behind `recipePhotoImport`.

**New model:** camera-based import becomes free via the OCR-first path. The `recipePhotoImport` feature flag's meaning shifts from "gates camera import as a whole" to "gates the AI vision enhancement" specifically — worth a one-line comment at the call site so this isn't confusing to a future reader. Vision quality becomes the paid differentiator; the barrier to _trying_ camera import at all drops to zero.

This shrinks the paid surface of an existing premium feature and is a deliberate product/monetization decision, not a UX simplification made unilaterally — it was explicitly proposed with its trade-off (see Extraction pipeline's "conditionally cheaper" caveat) and approved during this design's review cycle. Recorded here so a future reader has the provenance, not just the outcome.

## Backend changes

- **New service + route** for OCR-first structuring (e.g. `structureRecipeFromText`): takes 1-3 page texts (already OCR'd on-device, client-side, before upload) and returns a `RecipePhotoResult`-shaped result (see Quality gate) via a cheap text-only LLM call. **Not premium-gated.** Only text is uploaded, not images, so this path is also far lighter on bandwidth than the vision path.
- **Rate limiting is mandatory, not optional, precisely because this endpoint is free.** `docs/rules/api.md` and `docs/rules/security.md` both bind "every AI/OpenAI endpoint" to a limiter applied before the handler — verified precedent: `photoRateLimit` is already applied to all four existing routes in `photos.ts` (`:94`, `:293`, `:419`, `:455`). `structureRecipeFromText`'s route applies the same `photoRateLimit` (or an equally strict limiter) before the handler. Without premium gating to blunt abuse, this is the only cost control on the free path — it is not skippable.
- **Prompt-injection posture on OCR text**, per `docs/rules/ai-prompting.md` ("never embed unsanitized user-provided content in `system` role messages"): the 1-3 page texts are fully adversarial-controlled (anyone can photograph arbitrary text) and go into a **user**-role message only, never system. Each page text is length-capped server-side (untrusted clients can skip client-side compression/truncation); input exceeding the cap is rejected with a validation error, not silently truncated.
- **Response parsing reuses the existing four-guard pattern**, not a new one: `parseVisionResponse` (`photo-analysis.ts:278`, already used by `analyzeRecipePhoto` and three other vision calls) — explicit `JSON.parse` try/catch, top-level shape check, per-field Zod `safeParse`, narrow try/catch scope around the SDK call only. `structureRecipeFromText` calls the same helper rather than reimplementing guard logic.
- **Existing `analyzeRecipePhoto`** extended to accept an array of 1-3 images instead of one. Stays premium-gated on `recipePhotoImport`.
- **Upload limits:** cap at 3 images per request, with an explicit server-side total-body-size ceiling (not just reliance on client-side compression, which an untrusted client could skip). This is a file-upload-validation surface and should get a security-focused look during implementation, consistent with how this project already treats OWASP-relevant surfaces.

## Error handling

- OCR yields empty/near-empty text (blurry photo, no text at all) → fail fast with "Couldn't read any text in that photo," before spending an LLM call, offering retake or "Enhance with AI vision."
- One photo in a multi-photo batch fails to OCR → drop it, proceed with whatever succeeded. This is graceful degradation for the _pipeline_, but not silent for the _user_: a user who captured 3 photos and had one fail must see and hear that only 2 were used (e.g. "Used 2 of 3 photos — one couldn't be read"), not be left to notice a shorter recipe later and wonder why. Silent partial failure here is a UX defect, not just a missing nicety.
- Vision fallback failure → reuses `RecipePhotoImportScreen`'s existing error state (Try Again / Import from URL).

**Accessibility announcements.** `RecipePhotoImportScreen` already announces analyzing/review/error transitions via `AccessibilityInfo.announceForAccessibility` (`:108-123`) — the project treats this as a baseline, not optional polish. The states this design adds need the same treatment, none of which exist today:

- The "Add another page?" prompt after each capture.
- The partial-photo-drop notice above.
- Entering the `needsEnhance` sub-state (something like "Recipe extracted, but may be incomplete — enhance with AI vision available") and the transition back to a full result after a successful enhance retry.

## File-touch surface (`photoUri` → `photoUris[]`)

The route-param change from a single photo to a batch is small to state and wide to land — verified call sites that all need to move together:

- `MealPlanStackParamList` type — `RecipePhotoImport: { photoUri: string; ... }` (`MealPlanStackNavigator.tsx:44`)
- `useRecipePhotoImport` — `useMutation<RecipePhotoResult, Error, string>` (`useRecipePhotoImport.ts:8`)
- `RecipePhotoImportScreen` — `route.params` destructure, both `mutateAsync` call sites (`:82`, `:137`)
- `MealPlanHomeScreen.handlePhotoImport` — `navigation.navigate("RecipePhotoImport", { photoUri: uri, ... })` (`:787`)
- `RecipeEntryHubScreen.navigateWithPhoto` — same shape, its own call site
- `ImportRecipeSheet`'s `onPhotoImport: (uri, mealType, date) => void` prop and its three internal callers (`handleCamera`, `handleGallery`, `handleClipboard`)

This is exactly the kind of rename/signature-change sweep this project has had CI catch tails of before when it wasn't enumerated up front; the implementation plan should treat this list as a checklist, not rediscover it mid-implementation.

## Testing

- Pure functions with straightforward unit coverage: the quality-gate/completeness-check function (structured result → needs-enhance, yes/no), the OCR-text concatenation logic (order-preserving, page markers), the shared import-options config (data shape).
- Route tests for the new text-structuring endpoint: rate-limit path (429 beyond threshold), 1-3 item input validation, per-page length-cap rejection, confirms no premium gate.
- Security test: adversarial OCR text (e.g. "ignore previous instructions and...") is placed in a user-role message, is neither obeyed nor breaks structuring, and doesn't reach a system-role message anywhere in the call.
- Route tests for the modified `analyze-recipe` endpoint: accepts 1-3 images, still premium-gated, body-size ceiling enforced.
- Screen-level tests for `RecipePhotoImportScreen`: `photoUris` with 1 and 3 items; a low-quality result reaching `review` (not `error`) with `needsEnhance` true; free-tier tap → `UpgradeModal`, premium-tier tap → one-tap vision retry that replaces `result`; partial-photo-drop announces and shows the "used N of M" count.
- Existing tests for `ImportRecipeSheet`, `RecipeEntryHubScreen`, and the Home tab tile/card need updates for standalone-mode support, the removed client-side capture gate, and the new trigger behavior.
- `npm run preflight` (type-aware lint + tsc + tests + coverage) before opening the implementation PR, per this project's standing policy.

## Out of scope (Phase 2 or later — not decided now)

- **Share-sheet import** ("Share" a recipe from Safari/Instagram straight into OCRecipes). Needs a real native iOS Share Extension target and Android intent filter — not just JS/Expo config, and `ios/` is committed (not `prebuild`-generated), so a new target has to be hand-added to the Xcode project. Deferred partly because, as of 2026-06-24, a from-scratch native iOS build is broken (fmt 11.0.2 doesn't compile clean under Xcode 26.5/clang 21) — adding a new native target risks forcing exactly that from-scratch rebuild. Whether incremental builds are actually affected hasn't been verified either way.
- **Voice dictation** (speak a recipe aloud via existing `useSpeechToText`). Not selected — fully out, not planned as Phase 2 either.
- **Video/Reel import.** Never proposed; out of scope.
- **Premium "skip straight to vision" shortcut.** Deferred as a considered-but-unnecessary simplification (see Extraction pipeline).
