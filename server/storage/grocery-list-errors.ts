/**
 * The grocery list is not the user's, or no longer exists — e.g. deleted
 * between a route's ownership check and the locked recheck in
 * `insertGroceryListItemsUnderCap`. `handleRouteError` answers 404 for it
 * (reliability audit 2026-11-19, L-obs-2).
 *
 * Its own module, not re-exported through `storage/index.ts`: route tests mock
 * `../storage` with a factory, and `instanceof` against a class missing from
 * that mock would throw inside the shared error handler.
 */
export class GroceryListNotFoundError extends Error {
  constructor() {
    super("Grocery list not found for this user");
    this.name = "GroceryListNotFoundError";
  }
}
