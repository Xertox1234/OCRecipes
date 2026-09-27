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
      per 100 g.
- [ ] Cooking sessions: each ingredient's nutrition describes its quantity and unit.
      Metric and common units convert to grams. An unconvertible unit is marked, not
      silently per 100 g. Session totals sum portion values. This covers **fiber, sugar
      and sodium** too: `calculateSessionNutrition`'s per-ingredient items carry all seven
      nutrients (`shared/types/cook-session.ts`).
- [ ] Both callers look up the food by name (or a database-style lookup name), never
      with the quantity in the query.
- [ ] Per-100 g → portion conversion is shared with Quick Log, not duplicated: `toPortion`
      moves from `server/services/food-nlp.ts` to `server/services/portion-nutrition.ts`
      and is widened from four nutrients to all seven that `scaleNutrients` computes
      (its internal `scaled()` currently drops fiber/sugar/sodium).
- [ ] Tests cover scaling, no double scaling of per-serving results, and the
      unknown-weight case for both callers. The cooking adjustment test still passes on
      the corrected basis.
- [ ] Record a live before/after table (as above) in Updates.

## Implementation Notes

- Photo analysis has four intents (`server/services/photo-analysis.ts`). Only the paths
  that call `attachNutrition` need the weight. Prompt changes go through the
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
  `parseServingGrams` / `scaleNutrients`, and Quick Log's `toPortion` moved to a shared
  helper. Nothing new beyond a gram estimate in the photo prompt and a unit→grams table
  for cooking.
- **Files in scope:**
  - `server/routes/photos.ts`, `server/services/photo-analysis.ts`
  - `server/services/cooking-session.ts`
  - `server/services/food-nlp.ts` and `server/services/portion-nutrition.ts` (new), for
    the `toPortion` extraction, if this todo lands first
  - the matching `__tests__/` files
  - `client/hooks/usePhotoAnalysis.ts` / `client/screens/PhotoAnalysisScreen.tsx` only if
    the displayed serving label must change
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. Coordinate the shared helper with the beverage todo
  (`todos/P1-2026-09-27-beverage-log-uses-per-100g-nutrition-as-the-drink.md`), since
  whichever lands first extracts it.

## Risks

- Photo gram estimates vary. Bound them and keep temperature low.
- Historical photo logs and saved cooking sessions stay wrong. Correcting them is a
  separate, user-approved decision.

## Updates

### 2026-09-27

- Found while reviewing PR #1118 (Quick Log per-100 g fix). The user approved filing it.
- PR #1119 review: fixed the `calculateSessionMacros` line anchor, named the shared
  helper's path, and added fiber/sugar/sodium to the cooking-session criterion.
