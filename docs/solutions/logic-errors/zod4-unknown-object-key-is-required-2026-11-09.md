---
title: "zod 4 makes a z.unknown()/z.any() object key required — a lenient z.unknown().transform(parse) field now fails the whole parse when the key is absent"
track: bug
category: logic-errors
module: server
severity: high
tags: [zod, validation, api, ai-prompting]
symptoms: ["Invalid input: expected nonoptional, received undefined", "AI response with a missing optional field is rejected outright", "search response fails when an older server omits a field", "notebook extraction returns [] when the model leaves out moodDelta"]
applies_to: ['server/services/*.ts', 'shared/types/*.ts', 'shared/schemas/*.ts']
created: 2026-11-09
---

## Problem

zod 3 treated an object key declared `z.unknown()` or `z.any()` as optional. zod 4 does not: `z.object({ a: z.unknown() }).safeParse({})` fails with `invalid_type` / `expected: "nonoptional"`. A present-but-`undefined` key still passes, so only the *absent* key breaks.

The repo leans on `field: z.unknown().transform(parseX)` as a "lenient" field — never fail, normalise anything (including missing) to a safe value. Under zod 4 a missing key fails the whole object instead. Five such fields broke on the upgrade: `spiceLevel` (recipe-generation, recipe-chat, recipe-search), `dietConflicts` (recipe-search), `moodDelta` (coach-notebook — the model omitting it dropped every extracted notebook entry).

## Solution

Put `.optional()` between `z.unknown()` and the transform: `z.unknown().optional().transform(parseX)`. The transform then still runs on `undefined` (measured), so a missing key normalises exactly as in zod 3.

`z.preprocess(…)`, `.catch(…)` and `z.coerce.*().optional()` keys behave the same in zod 3 and 4 when absent (measured) — only bare `z.unknown()` / `z.any()` changed.

## Finding them

A line-based grep misses multi-line chains (`z\n  .unknown()\n  .transform(…)` — the `moodDelta` case). Sweep whitespace-insensitively for `z\s*\.\s*(unknown|any)\s*\(\s*\)` preceded by `key:` and check for `.optional()`/`.nullish()` in the chain; validate the sweep on the pre-fix tree (it must flag the known sites).

## Related Files

- `server/services/recipe-generation.ts`, `server/services/recipe-chat.ts`, `shared/types/recipe-search.ts`, `shared/schemas/coach-notebook.ts`
- [[zod4-default-inside-partial-resets-field-on-update-2026-11-09]] — the other zod 4 runtime change tsc does not catch
