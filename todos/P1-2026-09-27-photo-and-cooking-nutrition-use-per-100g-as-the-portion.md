---
title: "Photo analysis and cooking sessions use per-100 g nutrition as the portion"
status: backlog
priority: high
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [nutrition, photo-analysis, cooking]
github_issue:
---

# Photo analysis and cooking sessions use per-100 g nutrition as the portion

## Summary

Two more `lookupNutrition` callers put the quantity into the search text and use the
per-100 g result as if it were the portion. Photo analysis looks up `"<quantity> <name>"`
(e.g. "1 cup rice"). Cooking sessions look up `"<quantity> <unit> <name>"` for every
ingredient. The quantity changes neither the values nor the basis, and it degrades
matching. Scale each item to its portion and look up the food by name.

## Background

This is the same defect class as Quick Log (fixed in PR #1118, archived todo
`todos/archive/P1-2026-09-26-quick-log-calories-are-per-100g-not-per-portion.md`). The user
approved filing it on 2026-09-27 ("file the rest").

Measured through `lookupNutrition` on the local server, 2026-09-27:

| Query (caller shape)          | Match                                                    | kcal | servingSize |
| ----------------------------- | -------------------------------------------------------- | ---- | ----------- |
| `1 cup rice` (photo)          | Snacks, rice cakes, crackers                             | 392  | 100g        |
| `6 oz chicken breast` (photo) | Chicken breast with broccoli and cheese stuffing, frozen | 155  | 100g        |
| `2 cup flour` (cooking)       | Grains, wheat flour, white, cake flour                   | 368  | 100g        |
| `200 g pasta` (cooking)       | Sports drink (Gatorade G)                                | 26   | 100g        |

- **Photo analysis:** `server/routes/photos.ts` → `attachNutrition` builds
  `` `${f.quantity} ${f.name}` `` and attaches the result unchanged. The client displays it
  (`client/screens/PhotoAnalysisScreen.tsx:206`) and logs it
  (`client/hooks/usePhotoAnalysis.ts:317`, `calories: f.nutrition?.calories || 0`).
  `quantity` is a free-text AI estimate ("1 cup", "6 oz", "1 medium",
  `server/services/photo-analysis.ts`), with no gram weight.
- **Cooking sessions:** `server/services/cooking-session.ts` → `calculateSessionNutrition`
  and `calculateSessionMacros` (`:272`) builds
  `` `${i.quantity} ${i.unit} ${i.name}` ``. Its per-ingredient totals and the session
  total add up per-100 g values. `calculateCookedNutrition` then applies a cooking
  adjustment on top of the wrong basis.

## Acceptance Criteria

- [ ] Photo analysis: each identified food's nutrition describes the estimated portion.
      The analysis prompt returns an estimated gram weight (bounded, Zod-validated, same
      approach as Quick Log's `grams`), and the result is normalized through its
      `servingSize` and scaled. Unknown weight → clearly marked, never silently
      per 100 g. "Marked" means the `servingSize` string, as Quick Log does
      (`"100 g (portion unknown)"`), not a new field.
- [x] Cooking sessions: each ingredient's nutrition describes its quantity and unit.
      Metric and common units convert to grams. An unconvertible unit is marked, not
      silently per 100 g. Session totals sum portion values. This covers **fiber, sugar
      and sodium** too: `calculateSessionNutrition`'s per-ingredient items carry all seven
      nutrients (`shared/types/cook-session.ts`).
- [x] **Both** cooking functions are fixed: `calculateSessionMacros`
      (`server/services/cooking-session.ts`) is what writes the diary entry
      (`server/routes/cooking.ts` → `storage.createScannedItemWithLog`), and
      `calculateSessionNutrition` powers the pre-log summary. Fixing only the summary
      leaves the logged entries wrong.
- [ ] Both callers look up the food by name (or a database-style lookup name), never
      with the quantity in the query.
- [ ] Per-100 g → portion conversion is shared, not duplicated: use `scaleToGrams` /
      `nutrientValues` from `server/services/portion-nutrition.ts` (all seven nutrients;
      null when the basis can't be weighed). The beverage P1 added it; Quick Log's
      `toPortion` and the beverage route already call it.
- [ ] Tests cover scaling, no double scaling of per-serving results, and the
      unknown-weight case for both callers. The cooking adjustment test still passes on
      the corrected basis.
- [ ] Record a live before/after table (as above) in Updates.

## Implementation Notes

- Photo analysis: only the intents with `INTENT_CONFIG[intent].needsNutrition`
  (`shared/constants/preparation.ts`: `log`
  and `calories`) call `attachNutrition`, so only their prompts need the weight.
  `FoodItem` in `shared/types/photo-analysis.ts` is hand-kept in sync with
  `foodItemSchema` in `photo-analysis.ts`; adding `grams` touches both. Prompt changes go through the
  ai-reviewer and must keep `SYSTEM_PROMPT_BOUNDARY` and input sanitization.
- Cooking-session ingredients have a numeric `quantity` and a `unit` string
  (`shared/types/cook-session.ts`). A small unit→grams table (g, kg, oz, lb, ml, l, cup,
  tbsp, tsp) covers most entries. Volume units need a density assumption; say so in a
  comment.
- `batchNutritionLookup` is keyed by query string. Changing the query shape changes the
  map keys the callers read back, so update both sides together.
- The CNF matcher and cultural-alias substring fixes (running in parallel, 2026-09-27)
  change which foods some queries match. Re-measure after they merge.
- Split into two PRs (photo, cooking) if that's easier to review. Both share the helper.

## Scope Contract

- **Mechanisms to use:** the existing `lookupNutrition` / `batchNutritionLookup` chain,
  `parseServingGrams` / `scaleNutrients`, and the shared `scaleToGrams` in
  `server/services/portion-nutrition.ts`. Nothing new beyond a gram estimate in the photo prompt and a unit→grams table
  for cooking.
- **Files in scope:**
  - `server/routes/photos.ts`, `server/services/photo-analysis.ts`,
    `shared/types/photo-analysis.ts`
  - `server/services/cooking-session.ts`
  - the matching `__tests__/` files
  - `client/hooks/usePhotoAnalysis.ts` / `client/screens/PhotoAnalysisScreen.tsx` only if
    the displayed serving label must change
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The shared helper already landed with the beverage todo
  (`todos/archive/P1-2026-09-27-beverage-log-uses-per-100g-nutrition-as-the-drink.md`):
  `scaleToGrams` in `server/services/portion-nutrition.ts`.

## Risks

- Photo gram estimates vary. Bound them and keep temperature low.
- Historical photo logs and saved cooking sessions stay wrong. Correcting them is a
  separate, user-approved decision.

## Updates

### 2026-09-27

- Found while reviewing PR #1118 (Quick Log per-100 g fix). The user approved filing it.
- PR #1119 review: fixed the `calculateSessionMacros` line anchor, named the shared
  helper's path, and added fiber/sugar/sodium to the cooking-session criterion.
- PR #1119 re-review (advisory, applied in the codify PR): both cooking functions named in
  the AC (`calculateSessionMacros` writes the diary), "marked" defined as the
  `servingSize` string, `shared/types/photo-analysis.ts` added to scope, and the photo
  intents narrowed to `log`/`calories`.
- **Cooking half done** (PR for `fix/cooking-portion-nutrition`, after #1126). The user chose
  to fix the matcher first: bare "milk" matched dry milk powder, so scaling would have logged
  1 cup of milk at 1,190 kcal. #1126 makes dried/powder/flour forms lose near ties.
  - Each ingredient is looked up by name and scaled with `scaleToGrams`. Units: g, kg, oz,
    lb; ml, l, cup, tbsp, tsp at 1 g/ml for liquids ("dairy", "beverage", "other") and
    0.6 g/ml for chopped or dry solids ("grain", "vegetable", "fruit", "protein"). At water
    density, 2 cups of flour weighed 480 g (1,829 kcal live) and 2 cups of spinach 480 g. A unit with no weight keeps
    per-100 g values marked `"100 g (portion unknown)"` and cooks as 100 g.
  - Both functions share one per-ingredient helper; the diary totals equal the summary's
    (before cooking adjustments, which only the summary applies, as before).
  - The cooking adjustment was fed the bare quantity as grams: 1 cup of boiled rice cooked
    as 1 g (3 kcal).
  - Live, `calculateSessionNutrition` through the real lookup chain (unreachable DB, so no
    cache), main `fdb74f45` vs branch, kcal:

    | Ingredient                      | main | branch | Note                                 |
    | ------------------------------- | ---- | ------ | ------------------------------------ |
    | pasta 200 g                     | 357  | 714    | per 100 g × 2                        |
    | boneless skinless chicken 500 g | 120  | 600    | per 100 g × 5                        |
    | broccoli 300 g                  | 34   | 102    |                                      |
    | extra virgin olive oil 2 tbsp   | 0    | 240    | main's query hit API Ninjas' gated 0 |
    | unsalted butter 2 tbsp          | 717  | 215    |                                      |
    | milk 1 cup                      | 34   | 82     | "Milk, fluid, skim"                  |
    | long grain white rice 1 cup     | 365  | 526    | 144 g at 0.6 g/ml; a cup is ~185 g   |
    | flour 2 cup                     | 381  | 1,097  | "Yam, flour"; 288 g at 0.6 g/ml      |
    | black beans 1 cup               | 341  | 491    | dry raw beans; 144 g at 0.6 g/ml     |
    | carrot 1 cup                    | 41   | 59     | 144 g; chopped carrot ~128 g/cup     |
    | blueberries 1 cup               | 57   | 82     | 144 g; ~148 g/cup                    |
    | spinach 2 cup                   | 23   | 66     | 288 g; 2 cups of raw spinach ~60 g   |
    | whole milk 1 cup                | 108  | 259    | matcher: sheep's milk                |
    | large egg 3 piece               | 351  | 231    | marked "100 g (portion unknown)"     |
    | yellow onion 1 medium           | 132  | 132    | marked "100 g (portion unknown)"     |
    | rice 1 cup, Boiled              | 3    | 499    | main cooked "1 cup" as 1 g           |
    | egg 3 piece, Pan-Fried          | 12   | 276    | cooked as 100 g                      |

  - Residuals: count units ("piece", "medium") are per 100 g, not per item; volume density is
    a two-value assumption, and leafy greens by the cup come out about 4× high (spinach
    above); matcher misses (bare "flour" → yam flour, "whole milk" → sheep)
    are the P2/P3 matcher todos.
