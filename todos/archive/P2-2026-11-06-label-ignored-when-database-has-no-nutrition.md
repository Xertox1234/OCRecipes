---
title: "A photographed nutrition label is ignored when the database has no nutrition for the barcode"
status: done
priority: medium
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, nutrition, barcode, ocr]
github_issue:
---

# A photographed nutrition label is ignored when the database has no nutrition for the barcode

## Summary

When a scanned product is in Open Food Facts but has no nutrition values anywhere (OFF, CNF, USDA, API Ninjas), the user is asked to photograph the label, the label is read and POSTed, and then thrown away: the screen shows "—" for every value and says "These values come from the product database, not the label you photographed."

## Background

Seen on the owner's Android phone, 2026-11-06, during the barcode-decode check (`todos/archive/P3-2026-08-08-android-barcode-decode-never-verified.md`). Vanilla Coca-Cola, barcode `06722908`: OFF found the product, CNF missed, USDA missed, API Ninjas refused (premium-gated). The owner took the label photo and tapped "Looks right"; the client POSTed `/api/nutrition/barcode/06722908` (so its `isLabelReady` gate passed — calories and serving were read), the server answered 200, and the product screen showed "Serving size: 100g", "—" kcal / protein / carbs / fat. The owner's words: "it did not adopt the serving size from the nutrition label".

Cause (read from the code, not yet proven by a test): `buildLabelConflict` in `server/services/label-override.ts` only adopts the label on a **conflict** with the database. Its comparison loop skips every field where `dbVal == null`, so with an empty database record nothing is compared, `fields` is empty, and it returns "no conflict" — the same as agreement. The "on doubt, fail toward the DB result" rule assumes there is a DB result; here there is nothing to fail toward.

## Acceptance Criteria

- [x] A failing test first: a DB result whose per-100 calories (and the other compared fields) are null, plus a readable label (calories + parseable serving) → the response carries the label's values and serving, not the empty record.
- [x] When the DB has none of the compared nutrients, a readable label is adopted (scaled from the label's own serving), with the same flag recompute and wording the conflict path uses.
- [x] A DB record with real values keeps today's behaviour (adopt only on a material conflict) — existing `label-override` tests unchanged.
- [x] The screen no longer says the values come from the database when they came from the label.

## Implementation Notes

- `server/services/label-override.ts` → `buildLabelConflict` (early returns + comparison loop; `compared` / `labelCompared` semantics gate one-tap logging on the client — decide what an "adopted because empty" label means for that gate).
- `server/routes/nutrition.ts` POST `/api/nutrition/barcode/:code` (builds the response from `buildLabelConflict`).
- Client wording: search `client/` for "not the label you photographed".
- Keep the plausibility gates (serving parse, `MAX_PLAUSIBLE_LABEL_SERVING_GRAMS`) — an unreadable label must still be refused.

## Scope Contract

- Mechanisms: the existing label-override path; no new endpoint.
- Files in scope: the two server files above, their tests, and the client wording only.

## Updates

### 2026-11-06

- Filed from the owner's Android phone session.
- Fixed the same day (owner: "fix it now"). `buildLabelConflict` now treats a record that has no value for any compared field as empty. It adopts a readable label through the conflict path and keeps the record's other values. `compared` stays false there, so the log gate still asks the user to review. The gate's screen-reader text now says the values came from the label (`valuesFromLabel` on `LogGate`), not the database. The old "decline #3" test pinned the dropped-label behaviour, so it was rewritten.
