---
title: JSONB metadata versioning
track: knowledge
category: design-patterns
module: server
tags: [database, jsonb, zod, schema-evolution, validation, migration]
applies_to: [server/services/**/*.ts, server/storage/**/*.ts, shared/**/*.ts]
created: '2026-05-13'
---

# JSONB metadata versioning

## When this applies

When storing structured data in a JSONB column that may evolve over time, include a `metadataVersion` field and validate with Zod at write time.

## Examples

```typescript
// Define the schema with a version literal
const recipeChatMetadataSchema = z.object({
  metadataVersion: z.literal(1),
  recipe: z.object({
    title: z.string(),
    ingredients: z.array(z.object({ name: z.string(), quantity: z.string(), unit: z.string() })),
    instructions: z.array(z.string()),
    // ... other fields
  }),
  allergenWarning: z.string().nullable(),
  imageUrl: z.string().nullable(),
  savedRecipeId: z.number().optional(),
});

// Validate at write time — never store unvalidated JSONB
const metadata = { metadataVersion: 1, recipe: validatedRecipe, ... };
await storage.createChatMessage(id, "assistant", content, metadata);

// Validate at read time — use safeParse, not `as` casts
const parsed = recipeChatMetadataSchema.safeParse(msg.metadata);
if (!parsed.success) return null; // Handle legacy/invalid data gracefully
const { recipe } = parsed.data;
```

When the schema evolves, bump the version and add a normalizer:

```typescript
function normalizeRecipeMetadata(raw: unknown): NormalizedRecipe {
  const version = (raw as any)?.metadataVersion ?? 1;
  switch (version) {
    case 1:
      return transformV1(raw);
    case 2:
      return transformV2(raw);
    default:
      throw new Error(`Unknown metadata version: ${version}`);
  }
}
```

## When to use

Any JSONB column that stores structured data which may change shape over time (chat metadata, cached AI responses, user preferences).

## Why

JSONB has no schema enforcement at the database level. Without versioning, old rows silently break when code expects new fields.

## Related Files

- `server/services/recipe-chat.ts` — `recipeChatMetadataSchema`
- `server/storage/chat.ts` — `saveRecipeFromChat()` uses `safeParse` on metadata

## See Also

- [Typed JSONB columns with .$type<>() and sql default](typed-jsonb-columns-type-sql-default-2026-05-13.md)
- [Zod safeParse per JSONB element](../conventions/zod-safeparse-per-jsonb-element-2026-05-13.md)
- [Safe JSONB array access with Array.isArray guard](../conventions/safe-jsonb-array-access-isarray-guard-2026-05-13.md)
