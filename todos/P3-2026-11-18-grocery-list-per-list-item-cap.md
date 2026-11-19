---
title: "Cap the number of items on one grocery list"
status: backlog
priority: low
created: 2026-11-18
updated: 2026-11-18
assignee:
labels: [deferred, security, grocery]
github_issue:
---

# Cap the number of items on one grocery list

## Summary

Nothing limits how many items one grocery list can hold. The manual add route (`POST /api/meal-plan/grocery-lists/:id/items`) has only a request rate limit, and the coach grocery card's save reads every unchecked item of the chosen list for its duplicate check. Add a per-list item cap so that read is bounded.

## Background

Security audit 2026-11-18, finding C2 (`docs/audits/2026-11-18-security.md`). The coach `get_grocery_lists` read tool was fixed in the audit (open items capped per list in SQL). The card save's duplicate read (`getUncheckedGroceryListItems` in `server/services/write-cards/grocery.ts` `performGrocerySave`) was deliberately left unbounded: capping a dedup read would let duplicates through when the list is longer than the cap (see `docs/solutions/logic-errors/bounded-scan-window-forgets-a-users-permanent-decision-2026-11-14.md`). The real bound is the list size. Own data only; a cost amplifier, not a cross-user issue.

## Acceptance Criteria

- [ ] A per-list item cap constant (pick a number well above real use — e.g. 500 — and say why) enforced on every insert path: manual add route, generated lists (`createGroceryListWithLimitCheck`), the coach grocery card save, and any "add to list" from a recipe.
- [ ] Inserts check the cap under the same lock/transaction as the insert (count-then-insert under a per-list lock, like the pantry cap's `insertPantryItemsUnderCap`), so two concurrent adds can't both pass.
- [ ] Over the cap: the route returns a clear 4xx with an error code; the coach card reports the rows it left off, like the pantry cap does.
- [ ] Tests: N+1th add refused; concurrent adds at N-1 → exactly one succeeds.

## Implementation Notes

- Paths: `server/routes/grocery.ts` (~417, manual add), `server/storage/grocery-lists.ts` (`addGroceryListItems`, `createGroceryListWithLimitCheck`), `server/services/write-cards/grocery.ts` (`performGrocerySave`).
- Precedent for a cap applied under a lock with a "left off" count: `insertPantryItemsUnderCap` (`server/storage/pantry.ts`) and `MAX_PANTRY_ITEMS`.
- The client should show the error; check `client/` callers of the add-item endpoint.

## Scope Contract

- **Mechanisms to use:** a cap constant + count under a transaction lock, following `insertPantryItemsUnderCap`
- **Files in scope:** `server/routes/grocery.ts`, `server/storage/grocery-lists.ts`, `server/services/write-cards/grocery.ts`, their tests, and the client add-item error display
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A cap number is a product limit the user can hit; keep it generous.

## Updates

### 2026-11-18

- Initial creation from the 2026-11-18 security audit (C2, card-save part).
