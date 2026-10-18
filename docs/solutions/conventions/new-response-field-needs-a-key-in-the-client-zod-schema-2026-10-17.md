---
title: A new field on a server response reaches the client only if the client's Zod response schema names it — z.object strips unknown keys
track: knowledge
category: conventions
tags: [zod, validation, api, shared, typescript]
module: shared
applies_to: ["shared/types/*.ts", "client/hooks/*.ts"]
created: '2026-10-17'
---

# A new field on a server response reaches the client only if the client's Zod response schema names it

## Rule

When you add a field to a server response that the client parses with a Zod schema (`recipeSearchResponseSchema.safeParse(json)` and the like), add the field to that schema in the same change, together with a test that parses a response carrying the field and expects it to come out. Adding it to the TypeScript interface and to the server converter is not enough.

## Why

`z.object` strips every key it does not list. The server sends the field, the network tab shows it, the server tests pass, and `parsed.data` silently drops it. Every consumer then sees `undefined`, which looks exactly like "the server didn't send it". `tsc` does not catch this when the hook returns `parsed.data` as the hand-written interface type. In the attribute-icons work (2026-10-17), `SearchableRecipe` gained `dietConflicts`, but `searchableRecipeSchema` did not list it. The recipe browser would never have shown a diet icon, and every unit test was green.

## Examples

Make the schema key as lenient as its reader. A derived cache that may be missing on an older deploy, or malformed, should read as "not checked" rather than fail the whole response:

```ts
// shared/types/recipe-search.ts
dietConflicts: z.unknown().transform(parseDietConflicts), // missing / non-array → null, unknown ids dropped
```

Pin it with a test that would fail if the key were removed. Take the line out, watch the test fail, then put it back:

```ts
const parsed = recipeSearchResponseSchema.parse(responseWith({ dietConflicts: ["meat"] }));
expect(parsed.results[0].dietConflicts).toEqual(["meat"]);
```

## Exceptions

A field the client never reads can stay out of the schema. Stripping it is harmless and keeps the boundary no stricter than its readers.

## Related Files

- `shared/types/recipe-search.ts`
- `shared/types/__tests__/recipe-search-schema.test.ts`
- `client/hooks/useRecipeSearch.ts`

## See Also

- [A client-parsed response schema must live in shared/ with a provider-side test assertion](client-parsed-response-schema-needs-a-provider-side-assertion-2026-09-25.md)
- [Zod ingestion validation stricter than its readers](../logic-errors/zod-ingestion-validation-stricter-than-readers-2026-05-29.md)
