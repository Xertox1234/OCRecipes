---
title: "Gemini replies break output schemas tuned on GPT — enum values in other letter case, longer free-text phrases — normalise and trim instead of rejecting"
track: bug
category: logic-errors
module: server
tags: [ai-prompting, gemini, zod, validation]
applies_to: [server/services/**/*.ts]
symptoms: ["A row validates fine on gpt-4o but fails its Zod schema on Gemini (primary or Vertex backup)", "zod error \"Invalid enum value. Expected 'breakfast' | ..., received 'Breakfast'\"", "zod too_big on a short-phrase field; the service falls back to its default"]
created: '2026-11-03'
last_updated: '2026-11-03'
severity: medium
---

# Gemini replies break output schemas tuned on GPT

## Problem

The PR #1711 gate ran each text row's real service on Gemini 3.8 Flash (the Vertex backup).
Two schemas written against GPT output rejected valid Gemini answers:

- `pantry-meal-plan`: Gemini wrote `"mealType": "Breakfast"` (schema: lowercase enum) and the
  plan failed 3/3. `difficulty` has the opposite convention (`"Easy"`), equally fragile.
- `image-art-direction`: fields capped at 60–100 chars; Gemini's phrases were longer
  (`props` ≈ 105 chars), the whole direction was rejected and the plain default used.

Both were silent on the GPT route, which happens to match the casing and brevity.

The PR #1714 vision gate found a third shape: **null for "not given"**. Gemini wrote
`"unit": null` on every receipt item where GPT leaves the key out, and `.optional()`
rejects null, so `receipt-scan` failed 3/3.

## Symptoms

- Same prompt, same schema: passes on gpt-4o / gpt-4o-mini, fails on Gemini.
- `invalid_enum_value` with a differently-cased value, or `too_big` on a string field.
- `Expected string, received null` on a field declared `.optional()`.
- The service returns its error or stand-in value; the call record itself is clean (`stop`).

## Root Cause

The schema encoded one model's habits (casing, phrase length, omitting absent keys) as rules. The prompt never
stated the allowed values or a length, so a different model's equally valid answer fails.

## Solution

- Enum fields: `z.preprocess` that normalises case (lowercase for `mealType`, title case for
  `difficulty`) before the `z.enum` — unknown values still fail.
- Length caps on descriptive fields: `transform` that clips to the cap at a word boundary
  (`clip()` in `image-art-direction.ts`) instead of `.max()` — keeps the bound, keeps `min(1)`.
- Optional fields: `absentAsUndefined(z.string())` =
  `schema.nullish().transform((v) => v ?? undefined)` (receipt and menu analysis). It
  accepts null or a missing key, and the inferred type stays `T | undefined`, so callers
  don't change. Swept by target: every `.optional()` in the vision output schemas, not just
  the field that failed.

## Prevention

Before a row moves to a Gemini model (primary or backup), run its real service on the new
model and read the validation warnings, not just `finish_reason`. For a schema field the
prompt does not pin, tolerate case, trim length and read null as absent rather than reject.

## Related Files

- `server/services/pantry-meal-plan.ts`, `server/services/image-art-direction.ts` (+ tests)
- `server/services/receipt-analysis.ts`, `server/services/menu-analysis.ts` (+ tests)
- `scripts/ai-backup-gate-text-rows.ts`

## See Also

- [Vertex rejects an assistant-last conversation](vertex-rejects-conversation-ending-on-assistant-turn-2026-11-03.md) — found in the same gate run
- [json-mode answer truncated at the cap](../runtime-errors/json-mode-answer-truncated-at-token-cap-fails-whole-parse-2026-09-27.md) — the other way a model swap fails a schema
