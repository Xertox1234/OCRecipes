---
title: "Tighten updatePantryItem parameter type to Pick<> whitelist"
status: in-progress
priority: low
created: 2026-04-27
updated: 2026-04-27
labels: [typescript, security, architecture]
---

# Tighten updatePantryItem parameter type to Pick<> whitelist

## Summary

`updatePantryItem` in `server/storage/pantry.ts` accepts `Partial<InsertPantryItem>` for its updates parameter. Per the architecture pattern, storage update functions must use a `Pick<Entity, ...>` whitelist that excludes dangerous fields — a crafted call can currently overwrite the `userId` column, reassigning a pantry item to a different user.

## Background

This was a pre-existing issue in `server/storage/meal-plans.ts` that became more visible when `updatePantryItem` was extracted into its own module (`pantry.ts`) during the M11 storage decomposition refactor (commit `1661c0c`). The `where` clause correctly filters by both `id` and `userId`, so there is no current IDOR read risk — a caller cannot update another user's record — but the parameter type permits overwriting `userId`, `id`, or any other column without compile-time protection.

Flagged by code review after the architecture refactor (2026-04-27).

## Acceptance Criteria

- [ ] Define a `PantryItemUpdates` type using `Pick<InsertPantryItem, ...>` that includes only safe mutable fields (`name`, `quantity`, `unit`, `category`, `expiresAt`, and any other user-editable fields)
- [ ] `updatePantryItem` signature updated to use `PantryItemUpdates` instead of `Partial<InsertPantryItem>`
- [ ] All callers of `updatePantryItem` (via `storage.updatePantryItem`) compile without changes — confirm no caller passes a field outside the whitelist
- [ ] `npm run check:types` passes with 0 errors
- [ ] `npm run test:run` passes with no regressions

## Implementation Notes

Pattern from `docs/patterns/architecture.md` — "Update functions use pick types":

```typescript
type PantryItemUpdates = Pick<
  InsertPantryItem,
  "name" | "quantity" | "unit" | "category" | "expiresAt"
>;

export async function updatePantryItem(
  id: number,
  userId: string,
  updates: PantryItemUpdates,
): Promise<PantryItem | undefined> {
```

Grep callers first to confirm the whitelist is complete: `grep -rn "updatePantryItem" server/ client/`.

File to modify: `server/storage/pantry.ts`

## Dependencies

- None

## Risks

- A caller might be passing a field (e.g., `notes` or `isPurchased`) not yet included in the whitelist — would surface as a type error at the call site. Audit callers before finalising the `Pick` fields.

## Updates

### 2026-04-27

- Initial creation — surfaced by code review of commit `1661c0c`
