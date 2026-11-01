---
title: "Grocery-list cap: two parallel creates can both pass the count check"
status: backlog
priority: medium
created: 2026-11-01
updated: 2026-11-01
assignee:
labels: [deferred, server, data-integrity]
github_issue:
---

# Grocery-list cap: two parallel creates can both pass the count check

## Summary

`createGroceryListWithLimitCheck` counts a user's lists and then inserts, inside one transaction. At Postgres's default READ COMMITTED isolation, two parallel requests both see the count below the cap and both insert, so a user can end up one or more lists over the limit.

## Background

The pantry-cap todo (#1661, merged 2026-11-01) fixed the same count-then-insert shape for pantry items with a per-user advisory lock (`insertPantryItemsUnderCap`). Its review noticed the grocery-list path still has the race. The function's own comment calls it "TOCTOU-safe", but a transaction alone does not serialise two counts.

## Acceptance Criteria

- [ ] Two concurrent `createGroceryListWithLimitCheck` calls for the same user at `maxLists - 1` produce exactly one new list (DB test, both promises started before either awaits)
- [ ] The fix reuses the advisory-lock approach from #1661 (`pg_advisory_xact_lock` keyed per user, taken before the count)
- [ ] The misleading "TOCTOU-safe" comment is corrected
- [ ] Existing grocery-list tests still pass

## Implementation Notes

- `server/storage/grocery-lists.ts:100` — `createGroceryListWithLimitCheck`: take the lock as the first statement in `db.transaction(...)`, before the `count(*)` select.
- Copy the lock-key derivation from the pantry fix in `server/storage/` (`insertPantryItemsUnderCap`) so the two caps use distinct key namespaces.
- Test beside the existing grocery-list storage tests in `server/storage/__tests__/`.

## Scope Contract

- **Mechanisms to use:** the per-user transaction advisory lock pattern from #1661 — nothing new
- **Files in scope:** `server/storage/grocery-lists.ts`, its `__tests__` file
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A lock key colliding with the pantry lock would serialise unrelated work; keep the namespaces distinct.

## Updates

### 2026-11-01

- Filed by the /todo run (found during the #1661 pantry-cap review).
