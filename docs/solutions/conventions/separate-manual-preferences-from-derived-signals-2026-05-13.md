---
title: "Separate manual preferences from derived personalization signals"
track: knowledge
category: conventions
tags: [database, personalization, schema, separation-of-concerns, transactions]
module: server
applies_to: ["server/storage/**/*.ts", "shared/schema.ts"]
created: 2026-05-13
---

# Separate manual preferences from derived personalization signals

## Rule

When a feature captures recommendation input from user actions (recipe picks, likes, follows, dismissals), store that signal in its own table instead of mutating manually edited profile fields. Manual profile fields remain the user-authored source of truth; derived signals can be returned to callers, used for ranking, or used to invalidate personalization caches without overwriting what the user explicitly typed or selected in profile settings.

## Examples

```typescript
// `taste_picks` stores explicit recipe-level taste signals
export async function setTastePicks(userId: string, recipeIds: number[]) {
  return db.transaction(async (tx) => {
    await tx.delete(tastePicks).where(eq(tastePicks.userId, userId));
    await tx
      .insert(tastePicks)
      .values(recipeIds.map((recipeId) => ({ userId, recipeId })));

    const derivedCuisines = await deriveCuisinePreferences(tx, recipeIds);

    // Return derived cuisines for personalization, but do not mutate
    // userProfiles.cuisinePreferences here.
    return { cuisinePreferences: derivedCuisines };
  });
}
```

## When to use

- Personalization features where one signal is user-authored (`userProfiles`, settings forms) and another is behavior-derived (`taste_picks`, favorites, skips)
- Features that may later need history, ranking, or collaborative filtering without rewriting profile semantics

## Exceptions

- Cases where the field itself is explicitly edited by the user and there is no separate behavioral signal to preserve
- Derived values that are purely ephemeral and never need persistence

## Key elements

1. **Separate storage models** — keep manual preferences and behavioral/elicited signals in different tables or columns
2. **Manual profile stays authoritative** — do not silently rewrite profile fields from derived data
3. **Derive at read/write boundaries** — compute convenience outputs (for ranking, cache invalidation, response payloads) from the signal table when needed

## Related Files

- `docs/superpowers/plans/2026-05-10-taste-picks.md` — `taste_picks` plan and `setTastePicks()` notes
- `docs/superpowers/plans/2026-05-10-taste-picks.md` — onboarding flow keeps dietary profile save separate from taste-picks save
