---
title: "A label scan scales nutrition by servingsConsumed but stores servingSize unscaled — the ratio is unrecoverable, and the band layer now reads it"
status: done
priority: medium
created: 2026-08-13
updated: 2026-08-13
assignee:
labels: [deferred, api, database, nutrition]
github_issue:
---

# Label-scan saved items store scaled values against an unscaled serving size

## Summary

`POST` label-scan logging multiplies every macro by the user's `servingsConsumed`
but persists `servingSize` as the label's own unscaled string, and `scanned_items`
has no column recording the multiplier. The row therefore claims N servings' worth
of nutrition against a one-serving label, and nothing downstream can divide it back
out.

## Background

Found 2026-08-13 by `mobile-reviewer` during the roster review of PR #803 (the FSA
drink per-portion fix). It is **pre-existing** — PR #803 neither introduced it nor
touched `photos.ts` — but that PR widened its consequences, which is why it was
surfaced rather than left. Verified at the source, not taken from the report.

`server/routes/photos.ts:618-632`:

```ts
const servings = validated.servingsConsumed;      // user's stepper, default 1
const scaledSugar = clamp(labelData.totalSugars) * servings;   // …and 6 siblings
// …
servingSize: labelData.servingSize || null,       // NOT scaled
```

`shared/schema.ts` `scannedItems` carries `servingSize: text("serving_size")` and no
`servings`/`quantity` column, so once the row is written the multiplier is gone.

### Why PR #803 makes it matter more

The nutrition panel's saved-item path derives its per-100 basis from that stored
`servingSize` string, so an inflated row already skewed the per-100 traffic light.
PR #803 added a **second, lower-threshold arm** — the FSA per-portion override —
reachable by inputs the per-100 comparison does not catch:

|                       | value               | line | verdict        |
| --------------------- | ------------------- | ---- | -------------- |
| per-100 arm           | ~20 g/100 g         | 22.5 | under — no red |
| per-portion arm (new) | (20 × 150)/100 = 30 | 27   | **RED**        |

That row is a 150 g declared serving logged at `servingsConsumed = 3`: sugar is
tripled, `servingSize` still reads 150 g. Before #803 it produced no false red;
now it produces a false "High in sugar".

**Direction is over-warning** — a confident false claim about someone's food, which
is the direction this codebase's nutrient flags are otherwise built to avoid.

## Acceptance Criteria

- [x] A label-scan saved item logged with `servingsConsumed > 1` yields the same
      nutrient bands as the same product logged at 1 serving — the bands describe
      the product, not how much of it was eaten
- [x] The stored row is self-consistent: whatever `servingSize` says, the macro
      columns are the values for THAT serving
- [x] A regression test covers the 150 g / 3-servings shape above and asserts no
      spurious `high` sugar band
- [x] Existing rows are considered: either a migration, or an explicit written
      decision that historical rows stay as-is and why
- [x] The daily-log total a user sees for that entry does not change — whatever
      fixes the stored ratio must not silently halve or triple what they logged

## Implementation Notes

Two shapes, and the choice is the substance of this todo:

1. **Store per-serving values, keep the multiplier separate.** Add a `servings`
   numeric column to `scannedItems`, write unscaled macros, and multiply at read
   time for log totals. Cleanest data model and makes the row self-describing —
   but it is a schema change plus a migration, and every existing consumer of the
   macro columns has to learn to multiply.
2. **Scale the serving string too.** Keep writing scaled macros and write a
   `servingSize` that matches them (150 g × 3 → "450 g"). No schema change; the row
   becomes internally consistent immediately. But it fabricates a serving size the
   label never declared, which is the kind of invented denominator
   `docs/solutions/` already has entries warning about, and it degrades the
   `parseServingBasis` string users see on screen.

Recommend (1). Check `shared/schema.ts` `scannedItems`, every reader of its macro
columns, and `client/hooks/useNutritionLookup.ts`'s saved-item branch before
committing to it.

- **Do not** "fix" this in `client/components/nutrition/nutrition-band-source.ts` by
  suppressing the override on the saved-item path. That hides one symptom of a bad
  row while leaving the per-100 band, the macro strip and the daily-log total all
  still wrong.
- `MIGRATE PROD SCHEMA BEFORE MERGING` if option (1) adds a column — see
  `project_railway_autodeploy_migrate_ordering`.
- This is user-health-adjacent logic: **never delegate to a kimi-\* cheap worker.**

## Scope Contract

- **Mechanisms to use:** the existing Drizzle schema + migration flow and the
  existing storage/route layering — no new abstraction
- **Files in scope:** `server/routes/photos.ts`, `shared/schema.ts`, the
  `scanned_items` storage module and its readers, and the co-located `__tests__/`
  for each. `client/components/nutrition/nutrition-band-source.ts` is explicitly
  **out** of scope (see above).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #803 has merged; the widened symptom is live.

## Risks

- **Changing what a user's log says they ate.** Any repair to the stored ratio can
  move a historical daily total. Decide the migration story before touching the
  write path, and prefer leaving historical rows alone over silently restating them.
- A schema column addition must reach production before the code that reads it.

## Updates

### 2026-08-13

- Filed from the PR #803 roster review. Root cause verified directly at
  `server/routes/photos.ts:618-632` and `shared/schema.ts` rather than accepted
  from the reviewer's report.

### 2026-08-16

- **Implemented option (1) without a schema change.** `shared/schema.ts`
  already has the column this todo asked for — just on `dailyLogs`, not
  `scannedItems`: `dailyLogs.servings` (decimal, default `"1"`), and
  `getDailySummary`/`getPlannedNutritionSummary` already multiply
  `scannedItems.<macro> * dailyLogs.servings` / `* mealPlanItems.servings` at
  read time. `POST /api/photos/confirm-label` (`server/routes/photos.ts`) was
  the one write site that diverged from that convention: it baked
  `servingsConsumed` into the `scannedItems` macros while leaving
  `dailyLogs.servings` hardcoded at `"1"`. The fix stops scaling the macros
  and passes `servings: servingsConsumed.toString()` into
  `createScannedItemWithLog`'s `logOverrides` (`server/storage/nutrition.ts`),
  which now threads it onto the `dailyLogs` insert instead of the hardcoded
  `"1"`. No DDL, no migration, no `MIGRATE PROD SCHEMA BEFORE MERGING` step —
  the risk the todo flagged for option (1) does not apply here.
- **Full reader sweep** (`grep -rn` over `server/` for every
  `scannedItems.(calories|protein|carbs|fat|sugar|sodium|fiber)` read) found
  exactly two aggregate sites — `getDailySummary` and
  `getPlannedNutritionSummary` — both already multiplying by an independent
  servings/quantity column, so both become correct automatically with no
  code change. Every other reader (`getScannedItems`, `ItemDetailScreen.tsx`,
  `HistoryScreen.tsx`, CSV export) either dumps the raw row or displays
  `item.calories` next to `item.servingSize` under a "Per serving"/"Serving:"
  label — i.e. the UI already asserts per-serving semantics, which this fix
  satisfies for the first time on the label-scan path (previously that
  labeling was itself misleading whenever `servingsConsumed > 1`).
  `client/hooks/useNutritionLookup.ts`'s saved-item/`itemId` branch has no
  production caller (confirmed in that hook's own docblock and in
  `todos/archive/P3-2026-08-15-should-saved-item-path-populate-servingsizegrams.md`)
  — unaffected either way.
- **Existing rows (AC4) — explicit decision: leave them as-is, no backfill.**
  Every prior `confirm-label` write hardcoded `dailyLogs.servings = "1"` while
  scaling the macros into `scannedItems` by the real (now-lost)
  `servingsConsumed`. A historical row's `scannedItems.calories` (etc.) is
  therefore the OLD convention's total-for-the-log-entry, and
  `dailyLogs.servings = "1"` makes `getDailySummary`'s
  `calories * servings` arithmetic still land on the correct historical
  daily total. What's unrecoverable is only the split: "3 servings of a
  150 g label" and "1 serving of a 450 g portion" produced byte-identical
  rows before this fix, so there is no way to tell them apart after the
  fact, and no migration can restore it. Repairing the ratio in place would
  require guessing which case applied and risks silently changing a
  historical daily total (the Risk section's own dominant concern) for
  something a migration cannot actually verify. Leaving historical rows
  untouched is therefore not a deferral — it is the only option that doesn't
  either invent data or move a total a user already saw.
- **Regression coverage** (AC1/AC3, using the todo's own worked numbers — a
  150 g serving with 10 g of sugar, servingsConsumed = 3): a route-level
  test asserting `createScannedItemWithLog` is called with the unscaled
  `sugar: "10"` (not the pre-fix `"30"`) and `servings: "3"` on the log
  override; a second route-level test asserting the stored macros are
  byte-identical whether `servingsConsumed` is 1 or 3 (the AC1 invariance
  property directly, not a single hardcoded snapshot); a storage-level test
  asserting `logOverrides.servings` reaches the `dailyLogs` insert instead of
  the old hardcoded `"1"`; and — because AC3 names a _band_ assertion, not
  just a persistence one — a new case in the existing (untouched-source)
  `client/components/nutrition/__tests__/nutrition-band-source.test.ts`
  feeding `buildPanelRows` the fixed row's shape (`servingSize: "150 g"`,
  `sugar: 10`) and asserting the sugar band is not `high`: 10 g is under the
  27 g FSA per-portion line (`shared/constants/nutrition-bands.ts`), where
  the pre-fix 30 g would have crossed it. This adds a test case to that
  file's existing suite only — `nutrition-band-source.ts` itself (the Scope
  Contract's explicit exclusion) is untouched.
