---
title: "A label scan scales nutrition by servingsConsumed but stores servingSize unscaled — the ratio is unrecoverable, and the band layer now reads it"
status: backlog
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

- [ ] A label-scan saved item logged with `servingsConsumed > 1` yields the same
      nutrient bands as the same product logged at 1 serving — the bands describe
      the product, not how much of it was eaten
- [ ] The stored row is self-consistent: whatever `servingSize` says, the macro
      columns are the values for THAT serving
- [ ] A regression test covers the 150 g / 3-servings shape above and asserts no
      spurious `high` sugar band
- [ ] Existing rows are considered: either a migration, or an explicit written
      decision that historical rows stay as-is and why
- [ ] The daily-log total a user sees for that entry does not change — whatever
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
