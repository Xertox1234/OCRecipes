---
title: "Data parsed from a remote page gets the same caps as the manual-create schema — and a cap on text the user reads must split, not silently cut"
track: knowledge
category: conventions
module: server
tags: [security, architecture, api, database]
symptoms: [An imported recipe has a field longer than the manual-create schema allows, An imported recipe cannot be edited because the edit schema refuses its own stored values, The end of an imported recipe's method is missing with no message]
applies_to: ["server/services/recipe-import.ts", "server/services/recipe-import-caps.ts", "server/routes/recipe-import.ts", "server/routes/_meal-plan-schemas.ts"]
created: 2026-11-12
---

# Data parsed from a remote page gets the same caps as the manual-create schema

## Rule

When the server builds a row from something it fetched or parsed itself (a recipe page,
schema.org JSON-LD, a scraped block), the result passes through the **same limits** the
request schema enforces for the same row typed by hand. For recipes that is
`capImportedRecipe` in `server/services/recipe-import-caps.ts`, whose numbers mirror
`createMealPlanRecipeSchema`.

Where a cap applies to text the user reads and the source may legitimately exceed it,
**split or refuse — never cut without a word**. `capSteps` breaks an over-long step into
several steps (after a sentence if one ends in the second half of the reach, else at a
space, else mid-text); text is lost only past the 100-step count.

## Why

A request body is validated by Zod at the route. A parsed page skips the route schema:
the server is the one writing the values, so nothing checks them. Before the security
audit of 2026-11-12 (L9) an imported page could set a 2 MB title, a servings count that
overflows the integer column, or 10,000 ingredients — and the saved recipe then failed
the edit schema, so the user could not change it.

The first fix cut every field at its cap. Review showed that was a new defect: many real
pages give the whole method as **one** HTML block, a 2,000-character cut dropped the last
steps of a real recipe, and nothing told the user. A security cap that silently removes
content the user relies on (a cooking temperature, an allergen note) trades one problem
for another.

## Examples

```ts
// server/services/recipe-import.ts — the one exit of the parser
return { success: true, data: capImportedRecipe(parsed) };
```

- Short identity fields (title, cuisine, unit, tag): `cutText`, which never ends on half
  a surrogate pair.
- Counts (servings, minutes): `Math.min(value, max)`.
- Amounts no real serving has (calories over 50,000): `null`, not a clamped number — a
  clamped value would be shown as if the page had said it.
- Steps: split, as above. An HTML method block is first split at `</li>`, `</p>`,
  `</div>` and `<br>` so its own steps survive.

## Exceptions

- A field the user never reads back (an internal source id) may be cut.
- If a new cap cannot be split sensibly, refuse the import with a message instead.

## Related Files

- `server/services/recipe-import-caps.ts` — `IMPORT_CAPS`, `capSteps`, `capImportedRecipe`
- `server/services/__tests__/recipe-import-caps.test.ts`
- `server/routes/_meal-plan-schemas.ts` — the caps being mirrored

## See Also

- [tag-strip-regex-quadratic-on-unclosed-angle-brackets](../performance-issues/tag-strip-regex-quadratic-on-unclosed-angle-brackets-2026-11-12.md) — the same parser, time instead of size
- [unsafe-type-cast-zod-validation](../runtime-errors/unsafe-type-cast-zod-validation.md) — the general rule for data that did not come through a schema
