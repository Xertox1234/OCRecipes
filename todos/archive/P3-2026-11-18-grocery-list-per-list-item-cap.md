---
title: "Cap the number of items on one grocery list"
status: done
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

- [x] A per-list item cap constant (pick a number well above real use — e.g. 500 — and say why) enforced on every insert path: manual add route, generated lists (`createGroceryListWithLimitCheck`), the coach grocery card save, and any "add to list" from a recipe.
- [x] Inserts check the cap under the same lock/transaction as the insert (count-then-insert under a per-list lock, like the pantry cap's `insertPantryItemsUnderCap`), so two concurrent adds can't both pass.
- [x] Over the cap: the route returns a clear 4xx with an error code; the coach card reports the rows it left off, like the pantry cap does.
- [x] Tests: N+1th add refused; concurrent adds at N-1 → exactly one succeeds.

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

### 2026-11-18 (done)

- `MAX_GROCERY_LIST_ITEMS = 500` in `shared/constants/grocery.ts` (new file: no existing shared limits file; storage, routes and the app all need the number). Counts every row on the list, bought or not.
- One insert helper, `insertGroceryListItemsUnderCap(listId, items, executor)` in `server/storage/grocery-lists.ts`: per-list advisory lock (`grocery-list-items:<id>`, released at commit), count, add what fits, return `{ created, skipped }`. It replaces `addGroceryListItem` / `addGroceryListItems`, so no uncapped insert is left exported.
- Scope widened past the listed files to cover every insert path (the criterion says every path): `server/storage/batch.ts` (batch scan into a list) and `server/services/write-cards/plan.ts` (plan card "add shopping") also insert grocery items.
- Per path:
  - manual add route → 400 `LIMIT_REACHED` "This list is full (500 items)";
  - generate route → refuses with 400 `LIMIT_REACHED` when the range's items exceed 500, rather than a list that is silently missing some;
  - `createGroceryListWithLimitCheck` → goes through the helper and returns `skipped`;
  - Coach grocery card → adds what fits; `savedRefs.groceryListFull` + receipt "N didn't fit (list full)" (no longer counted as "already there");
  - Coach plan card → meals still planned, groceries take what fits, `groceryListFull` recorded (the plan receipt does not mention groceries at all today, so it is not shown there);
  - batch scan → adds what fits, returns `skipped`; the batch summary toast now names the list instead of always saying "Pantry full".
- App: the grocery list screen's add box shows "List full: 1 item wasn't added" (a 4xx skips the global error toast, so it was silent); the list picker shows a "List full" alert instead of "Failed to add".
- Tests: `grocery-list-items.concurrent.test.ts` (new; real multi-connection DB). The race test failed with the lock left out (`expected 2 to be 1`) and passes with it, 10 rounds. Also route, card, plan, batch and app copy/modal tests.
