---
title: "Self-referencing FK with snapshot column for graceful degradation"
track: knowledge
category: design-patterns
tags:
  [database, schema, drizzle, foreign-keys, denormalization, soft-references]
module: shared
applies_to: ["shared/schema.ts", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Self-referencing FK with snapshot column for graceful degradation

## When this applies

When a row references another row in the same table (or a row that may be deleted), use `onDelete: "set null"` paired with a denormalized snapshot column to preserve display data after deletion.

## Examples

```typescript
// Schema: communityRecipes has remixedFromId (self-referencing)
remixedFromId: integer("remixed_from_id").references(
  (): AnyPgColumn => communityRecipes.id,
  { onDelete: "set null" },
),
remixedFromTitle: text("remixed_from_title"), // snapshot of original title
```

```typescript
// UI handles three states:
// 1. remixedFromId set → tappable link to original
// 2. remixedFromId null, remixedFromTitle set → original deleted, show title only
// 3. neither set → not a remix
{recipe.remixedFromTitle && (
  <Pressable
    onPress={recipe.remixedFromId ? () => navigate(recipe.remixedFromId) : undefined}
    disabled={!recipe.remixedFromId}
  >
    <Text>Remixed from {recipe.remixedFromTitle}</Text>
  </Pressable>
)}
```

## When to use

Any lineage/provenance relationship where the referenced row may be deleted but the display text should survive. Examples: recipe remixes, forked items, reply-to references.

## Why not onDelete: cascade?

Cascade deletion of a recipe would destroy all its remixes — surprising and destructive. `set null` preserves the child row; the snapshot column preserves the display text.

## Note

Requires `AnyPgColumn` import from `drizzle-orm/pg-core` for self-referencing FKs (Drizzle evaluates the lambda lazily).

**Origin:** Recipe Remix feature (2026-04-08)
