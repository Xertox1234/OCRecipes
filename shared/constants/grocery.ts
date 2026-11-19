/**
 * Hard cap on items (bought or not) on one grocery list, enforced on every
 * insert path by `insertGroceryListItemsUnderCap`. A real week's shop is well
 * under 100 lines; 500 leaves room for a 90-day generated list while bounding
 * every read of a whole list (security audit 2026-11-18, C2).
 */
export const MAX_GROCERY_LIST_ITEMS = 500;
