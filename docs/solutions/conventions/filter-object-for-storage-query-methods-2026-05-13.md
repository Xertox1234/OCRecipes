---
title: Filter object for storage query methods
track: knowledge
category: conventions
module: server
tags: [database, storage, api-design, drizzle, ergonomics]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Filter object for storage query methods

## Rule

When a storage method supports optional filtering by date range, pagination, or other criteria, accept a single options object with optional fields instead of positional parameters. This avoids long parameter lists and makes call sites self-documenting.

## Examples

```typescript
// server/storage.ts — shared filter pattern used by 6+ methods
async getWeightLogs(
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<WeightLog[]> {
  const conditions = [eq(weightLogs.userId, userId)];
  if (options?.from) conditions.push(gte(weightLogs.loggedAt, options.from));
  if (options?.to) conditions.push(lt(weightLogs.loggedAt, options.to));

  let query = db
    .select()
    .from(weightLogs)
    .where(and(...conditions))
    .orderBy(desc(weightLogs.loggedAt));

  if (options?.limit) query = query.limit(options.limit);
  return query;
}

// Call sites are self-documenting:
const logs = await storage.getWeightLogs(userId, { from: fourWeeksAgo });
const recent = await storage.getWeightLogs(userId, { limit: 7 });
const range = await storage.getWeightLogs(userId, { from: start, to: end });
const all = await storage.getWeightLogs(userId); // no filters
```

## When to use

- Any storage method that accepts 2+ optional filter parameters
- Date-range queries (weight logs, exercise logs, fasting logs, daily summaries)
- List endpoints that support optional pagination and filtering

## Exceptions

- Methods with a single required parameter beyond userId (use positional)
- Methods where the filter is always the same shape (use dedicated parameters)

## Key elements

1. **Optional object parameter** — `options?: { from?: Date; to?: Date; limit?: number }` with `?` on every field
2. **Build conditions array** — push to `conditions` array conditionally, then spread into `and()`
3. **Consistent field names** — use `from`/`to`/`limit` across all methods for predictability
4. **Default to no filter** — when options is undefined, return all records for the user

## Related Files

- `server/storage.ts` — `getWeightLogs()`, `getExerciseLogs()`, `getScannedItems()`, `getFastingLogs()`, `getMedicationLogs()`, `getChatMessages()`
