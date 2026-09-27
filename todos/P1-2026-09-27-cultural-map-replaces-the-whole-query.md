---
title: 'Cultural food map replaces the whole query once an alias appears: "buttermilk pancakes" is looked up as "yogurt drink"'
status: backlog
priority: high
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [nutrition, architecture]
github_issue:
---

# Cultural food map replaces the whole query once an alias appears: "buttermilk pancakes" is looked up as "yogurt drink"

## Summary

`fetchNutritionFromSources` (`server/services/nutrition-lookup.ts`) passes every query
through `getStandardizedFoodName`, which swaps the **entire** query for a cultural entry's
`standardName` whenever any alias appears in it as a word. A food that merely contains a
dish word gets that dish's nutrition, and so does a food the databases already list
exactly. The wrong result is cached under the original query for every user for 7 days.
Only rewrite when the query is the dish itself, or only as a fallback after the original
query fails.

## Background

Found while fixing the substring version of this matcher in PR #1120 (which made aliases
match whole words only). The user chose to file it on 2026-09-27 ("file the todo").

Measured on `main` after #1120 (2026-09-27), over the 5,690 foods in the Canadian Nutrient
File (CNF) English list: 127 are still rewritten, by 19 of the map's 64 entries (the other 45 match no CNF
name).

- **A different food:** all 27 buttermilk rows (e.g. "Milk, fluid, buttermilk, cultured,
  1% M.F.", "Pancake, buttermilk, homemade") → "yogurt drink". "Wonton wrapper (egg roll
  wrapper)" → "spring roll". "Taco shell, baked" → "corn tortilla with filling".
  "Fast foods, mexican, tostada with guacamole" → "avocado dip".
- **An ingredient becomes a dish:** "taco seasoning" → "corn tortilla with filling",
  "lasagna noodles" → "layered pasta casserole", "egg roll wrapper" → "spring roll".
- **An exact CNF row is thrown away:** "Hummus, homemade" is searched as "chickpea dip",
  "Lasagna, vegetable, frozen, baked" as "layered pasta casserole", and "Grains, couscous,
  cooked" as "semolina grain". CNF has rows for the original names, which the rewrite
  never reaches.
- **The rewritten name often finds nothing.** Measured through `fuzzyMatchCNF` against
  the CNF EN list: "hummus" → "Hummus, homemade", but "chickpea dip" → no match;
  "lasagna" → "Lasagna, vegetarian, homemade", but "layered pasta casserole" → no match;
  "yogurt drink" → no match. Each such lookup falls through to USDA's search with a vague
  phrase. (Separate residual: bare "buttermilk" matches "Pancake, buttermilk, homemade".
  The matcher's own ranking, not this rewrite.)

The rewrite runs before CNF and USDA in `fetchNutritionFromSources` and applies to every
`lookupNutrition` / `batchNutritionLookup` caller (Quick Log, photos, cooking sessions,
beverages, coach, `/api/nutrition/lookup`, barcode's USDA fallback).
`photo-analysis.ts` also uses the same match for `getCuisineForFood` (a cuisine label, so
lower stakes).

## Acceptance Criteria

- [ ] A query that contains an alias alongside other food words is **not** replaced
      wholesale: "buttermilk pancakes", "taco seasoning", "egg roll wrapper" and "lasagna
      noodles" are looked up as themselves.
- [ ] A query CNF or USDA can already match is not rewritten: "hummus" and "couscous"
      resolve to their own CNF rows. The simplest design satisfying this is: look up the
      original query first, and use the cultural `standardName` only if that fails.
- [ ] Genuinely cultural queries still benefit: "doro wat", "injera", "2 naan", "jollof
      rice" and "chicken bulgogi bowl" resolve at least as well as today. Record each
      one's result before and after.
- [ ] Measured, not reasoned: over the CNF EN list, report how many foods the map rewrites
      and how many of those rewrites are wrong, before and after (baseline 127 rewrites,
      2026-09-27). Also run the **gold set below** (Implementation Notes) through
      `lookupNutrition`'s CNF step in each caller's query shape (bare, `2 `, `1 cup `,
      `3 oz `, `1 medium `, `12oz `, `1/2 cup `). Its right/wrong/no-match counts must not
      get worse (2026-09-27 baseline through `fuzzyMatchCNF` alone: 41 / 6 / 4 in every
      shape). The method is in
      `docs/solutions/logic-errors/food-name-matcher-whole-words-gold-set-2026-09-27.md`.
- [ ] `getCuisineForFood` behavior is either unchanged or deliberately changed and noted.
- [ ] Tests: negatives above with positive controls beside them in the same block, plus a
      `nutrition-lookup` test that the original query is tried before the standardized
      one (if the fallback design is chosen).

## Implementation Notes

- Two workable designs; measure both if unsure:
  1. **Fallback:** `lookupCNF(query)` → USDA → only then retry with the `standardName`.
     This keeps exact rows and fixes the ingredient cases, at the cost of an extra lookup
     on misses.
  2. **Whole-query match only:** rewrite only when the query, minus a leading quantity
     (see `withoutLeadingQuantity`), is the alias itself (plus a plural). This is cheap,
     but "chicken bulgogi bowl" (a test in `cultural-food-map.test.ts`) would stop
     rewriting.
- Cache keys use the original query, so a design change retires wrong cached entries only
  as they expire (7-day TTL). No production cache step is needed, but say so in Updates.
- Several `standardName`s are vague ("yogurt drink", "stuffed tortilla") and match poorly
  on their own. Improving them is optional, and must be measured the same way.
- **Gold set** (the 51 queries behind the 41 / 6 / 4 baseline, not committed elsewhere yet;
  `todos/P3-2026-09-27-cnf-matcher-review-followups.md` item 2 turns it into a fixture).
  Each query is `query → regex the correct CNF description must match`; a match that fails
  the regex is "wrong", no match is "no match":
  - Bare names: egg → `^Egg, chicken, whole` · butter → `^Butter, ` · banana →
    `^Banana, raw` · apple → `^Apple,` · almonds → `^Nuts, almonds` · orange juice →
    `^Orange juice` · bagel → `^Bagel, ` · rice → `^Grains, rice` · avocado →
    `^Avocado, raw` · potato → `^Potato,` · tomato → `^Tomato,` · carrot → `^Carrot,` ·
    onion → `^Onion,` · corn → `^Corn, ` · salmon → `^Fish, salmon` · tofu → `^Tofu` ·
    spinach → `^Spinach,` · broccoli → `^Broccoli,` · cheddar cheese →
    `^Cheese, cheddar` · peanut butter → `^Peanut butter` · honey → `^Sweets, honey` ·
    sugar → `^Sweets, sugars?, ` · white sugar → `^Sweets, sugars, granulated` · olive
    oil → `^Vegetable oil, olive` · ground beef → `^Beef, ground` · lentils → `^Lentils,`
    · black beans → `^Beans, black` · strawberries → `^Strawberry,` · watermelon →
    `^Watermelon` · papaya → `^Papaya, raw` · milk → `^Milk, fluid` · coffee →
    `^Coffee, brewed` · greek yogurt → `^Yogourt, Greek` · chicken breast →
    `^Chicken, broiler, breast`
  - Database-style names: egg, chicken, whole, cooked → `^Egg, chicken, whole, cooked` ·
    egg chicken whole raw → `^Egg, chicken, whole, fresh or frozen, raw` · bread, whole
    wheat, toasted → `^Bread, whole wheat.*toasted` · butter, salted → `^Butter,` ·
    banana, raw → `^Banana, raw` · apple, raw → `^Apple, raw` · almonds, raw →
    `^Nuts, almonds` · juice, orange, fresh-squeezed → `^Orange juice` · bread, bagel,
    plain → `^Bagel, plain` · rice, white, long-grain, cooked →
    `^Grains, rice, white, long-grain.*cooked` · carbonated drinks, cola →
    `^Carbonated drinks, cola` · yogurt, greek, plain → `^Yogourt, Greek style, plain` ·
    chicken, breast, roasted → `^Chicken, broiler, breast` · avocado, raw →
    `^Avocado, raw` · coffee, brewed → `^Coffee, brewed` · milk, 2% →
    `^Milk, fluid, partly skimmed, 2%` · watermelon, raw → `^Watermelon, raw`

## Scope Contract

- **Mechanisms to use:** the existing `lookupCulturalFood` / `getStandardizedFoodName`,
  `fetchNutritionFromSources`, and `withoutLeadingQuantity`. Nothing new.
- **Files in scope:**
  - `server/services/cultural-food-map.ts`, `server/services/nutrition-lookup.ts`
  - `server/services/__tests__/cultural-food-map.test.ts`,
    `server/services/__tests__/nutrition-lookup.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. `todos/P3-2026-09-27-cnf-matcher-review-followups.md` also touches
  `nutrition-lookup.ts`; don't run them in parallel.

## Risks

- The fallback design adds a CNF + USDA round trip on every miss before the rewrite.
  USDA's DEMO_KEY limit is 40 requests/hour when `USDA_API_KEY` isn't set.
- Entries already logged with the wrong food stay wrong. Correcting historical data is a
  separate, user-approved decision.

## Updates

### 2026-09-27

- Surfaced as HIGH during PR #1120. The user chose to file it ("file the todo").
- PR #1122 review: corrected the entry count (19 of 64 entries rewrite anything, not 64),
  and inlined the 51-query gold set so the measurement criterion is runnable.
