import type { QueryClient } from "@tanstack/react-query";
import type { GroceryListItem } from "@shared/schema";
import { apiRequest } from "./query-client";
import { QUERY_KEYS } from "./query-keys";
import { recipeStatsKey } from "@/hooks/useRecipeCommunity";
import type { ChatConversation } from "@/hooks/useChat";

/**
 * Durable-resume registry for the offline mutations that are safe to replay.
 *
 * TanStack pauses a mutation fired offline (networkMode "online"), but the
 * pause lives in memory only. The persister saves a paused mutation's key and
 * variables, never its `mutationFn`; after a restart a mutation resumes only
 * if `setMutationDefaults(key, { mutationFn })` was registered for its key
 * (`shouldDehydrateResumableMutation` in query-client-persistence.ts refuses to
 * persist the rest). Everything registered here MUST take only serializable
 * variables, since a restored mutation has no component state to close over.
 *
 * Owner ruling (2026-10-31): only on/off toggles survive a restart. Each
 * `onSettled`/`onSuccess` below carries the cache reconcile a restored mutation
 * would otherwise lose (the mounted hook's own handlers are gone after a kill).
 *
 * Classification of every `useMutation` site (todo 2026-10-30, AC 1):
 *
 *  DURABLE (registered below):
 *   - useToggleGroceryItem        PUT with an explicit `isChecked` (last write wins)
 *   - useToggleFavouriteRecipe    POST toggle (a server-side flip, see note)
 *   - useToggleFavourite          POST toggle on a scanned item (a flip, see note)
 *   - usePinConversation          PATCH with an explicit `isPinned` (last write wins)
 *
 *  IN-MEMORY-PAUSED (not registered; replaying hours later is unsafe):
 *   - creates (duplicate risk): useCreateGroceryList, useAddManualGroceryItem,
 *     useCreateSavedItem, cookbook / meal-plan / pantry / recipe-import creates,
 *     useSaveRecipeFromChat, useSaveGeneratedMealPlan, useGenerateMealPlan
 *   - edits and reorders (stale-write risk): meal-plan and cookbook edits,
 *     goal setup, coach reminder edits, useQuickLogSession, useBatchConfirm
 *   - deletes: useDeleteGroceryList, useDeleteSavedItem, useDiscardItem
 *   - one-way actions, not on/off: useDismissCarouselRecipe, useAcknowledgeReminders,
 *     useAddGroceryItemToPantry, useMarkPendingRecipeTurn
 *   - AI / upload / streaming calls (long-running, not replayable): chat send,
 *     label / menu / receipt / photo scans, nutrition lookup, food parse,
 *     meal suggestions, inspired suggestions, cook sessions
 *   - useSetRecipeTried is an explicit-state toggle but needs a reshape first:
 *     its recipe id lives only in the (per-recipe) key, not in the variables.
 *
 *  NOTE: the two favourite endpoints are flips, not set-value calls, so a replay
 *  after an intervening change on another device inverts that change. The owner
 *  ruling names favourites explicitly; accepted.
 */

export const TOGGLE_GROCERY_ITEM_KEY = ["toggle-grocery-item"] as const;
export const TOGGLE_FAVOURITE_RECIPE_KEY = ["toggle-favourite-recipe"] as const;
export const TOGGLE_FAVOURITE_ITEM_KEY = ["toggle-favourite-item"] as const;
export const PIN_CONVERSATION_KEY = ["pin-conversation"] as const;

// --- grocery check-off -------------------------------------------------------

export interface ToggleGroceryItemVars {
  listId: number;
  itemId: number;
  isChecked: boolean;
}

export async function toggleGroceryItemFn({
  listId,
  itemId,
  isChecked,
}: ToggleGroceryItemVars): Promise<GroceryListItem> {
  const res = await apiRequest(
    "PUT",
    `/api/meal-plan/grocery-lists/${listId}/items/${itemId}`,
    { isChecked },
  );
  return res.json();
}

export function settleGroceryToggle(
  client: QueryClient,
  { listId }: ToggleGroceryItemVars,
): void {
  void client.invalidateQueries({
    queryKey: ["/api/meal-plan/grocery-lists", listId],
  });
}

// --- recipe favourite --------------------------------------------------------

export interface ToggleFavouriteRecipeVars {
  recipeId: number;
  recipeType: "mealPlan" | "community";
}

export async function toggleFavouriteRecipeFn({
  recipeId,
  recipeType,
}: ToggleFavouriteRecipeVars): Promise<{ favourited: boolean }> {
  const res = await apiRequest("POST", "/api/favourite-recipes/toggle", {
    recipeId,
    recipeType,
  });
  return res.json();
}

export function settleFavouriteRecipeToggle(
  client: QueryClient,
  { recipeId, recipeType }: ToggleFavouriteRecipeVars,
): void {
  void client.invalidateQueries({ queryKey: ["/api/favourite-recipes/ids"] });
  void client.invalidateQueries({ queryKey: ["/api/favourite-recipes"] });
  if (recipeType === "community") {
    void client.invalidateQueries({ queryKey: recipeStatsKey(recipeId) });
  }
}

// --- scanned-item favourite --------------------------------------------------

export async function toggleFavouriteItemFn(
  itemId: number,
): Promise<{ isFavourited: boolean }> {
  const res = await apiRequest(
    "POST",
    `/api/scanned-items/${itemId}/favourite`,
  );
  return res.json();
}

export function settleFavouriteItemToggle(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
}

// --- conversation pin --------------------------------------------------------

export interface PinConversationVars {
  id: number;
  isPinned: boolean;
}

export async function pinConversationFn({
  id,
  isPinned,
}: PinConversationVars): Promise<ChatConversation> {
  const res = await apiRequest("PATCH", `/api/chat/conversations/${id}/pin`, {
    isPinned,
  });
  return (await res.json()) as ChatConversation;
}

export function settlePinConversation(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
}

/**
 * Register the defaults. Called once at module scope from
 * query-client-persistence.ts (which App.tsx imports before the persister
 * restores). Takes the client as a parameter so this module has no import-time
 * dependency on the `queryClient` singleton: hook tests mock
 * `@/lib/query-client` without it.
 */
export function registerMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults(TOGGLE_GROCERY_ITEM_KEY, {
    mutationFn: toggleGroceryItemFn,
    onSettled: (_data, _err, vars) =>
      settleGroceryToggle(client, vars as ToggleGroceryItemVars),
  });
  client.setMutationDefaults(TOGGLE_FAVOURITE_RECIPE_KEY, {
    mutationFn: toggleFavouriteRecipeFn,
    onSettled: (_data, _err, vars) =>
      settleFavouriteRecipeToggle(client, vars as ToggleFavouriteRecipeVars),
  });
  client.setMutationDefaults(TOGGLE_FAVOURITE_ITEM_KEY, {
    mutationFn: toggleFavouriteItemFn,
    onSettled: () => settleFavouriteItemToggle(client),
  });
  client.setMutationDefaults(PIN_CONVERSATION_KEY, {
    mutationFn: pinConversationFn,
    onSettled: () => settlePinConversation(client),
  });
}
