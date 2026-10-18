import { skipToken, useQuery, type QueryClient } from "@tanstack/react-query";

// ---- Background recipe generation: unread / pending / ready ----
//
// Generating a recipe takes 11–13 s. The sheet that started it closes at
// once (spec 2026-10-17 recipe-generate-argon-background-completion §5); the
// request keeps running and, when it lands, the user is told by a toast and a
// dot on the Profile tab. Three pieces of session state make that work:
//
//  - which generated recipes the user has not opened yet (the Profile dot),
//  - whether a generation is in flight per entry point ("photo" sheet,
//    "mealPlan" screen) — one at a time each (owner ruling 2026-10-17),
//  - a "recipe ready" emitter the toast bridge subscribes to, because the
//    request completes in a hook that may already be unmounted.
//
// Same design as `useCoachUnreadReplies.ts` (#1216): state lives in the
// TanStack Query cache under sentinel keys so `queryClient.clear()` on every
// auth teardown path wipes it (docs/solutions/design-patterns/
// query-cache-as-ephemeral-client-store-2026-09-29.md). Its two gotchas apply:
// pin `gcTime: Infinity` before the first write, and never write `undefined`
// to clear. Neither key is in App.tsx's PERSISTED_QUERY_KEYS allowlist.

/** Ids of generated recipes the user has not opened yet, as `number[]`. */
export const UNREAD_GENERATED_RECIPES_KEY = [
  "__unreadGeneratedRecipes",
] as const;
/** In-flight flag per entry point, as `Record<GenerationEntry, boolean>`. */
export const PENDING_RECIPE_GENERATION_KEY = [
  "__pendingRecipeGeneration",
] as const;

export type GenerationEntry = "photo" | "mealPlan";

type PendingGeneration = Partial<Record<GenerationEntry, boolean>>;

function pinSentinelKeys(queryClient: QueryClient): void {
  queryClient.setQueryDefaults(UNREAD_GENERATED_RECIPES_KEY, {
    gcTime: Infinity,
  });
  queryClient.setQueryDefaults(PENDING_RECIPE_GENERATION_KEY, {
    gcTime: Infinity,
  });
}

export function getUnreadGeneratedRecipeIds(
  queryClient: QueryClient,
): number[] {
  return queryClient.getQueryData<number[]>(UNREAD_GENERATED_RECIPES_KEY) ?? [];
}

/** Record that `recipeId` was generated and not yet opened. Idempotent. */
export function markGeneratedRecipeUnread(
  queryClient: QueryClient,
  recipeId: number,
): void {
  pinSentinelKeys(queryClient);
  const ids = getUnreadGeneratedRecipeIds(queryClient);
  if (ids.includes(recipeId)) return;
  queryClient.setQueryData<number[]>(UNREAD_GENERATED_RECIPES_KEY, [
    ...ids,
    recipeId,
  ]);
}

/** Drop one recipe's unread mark. The last mark clearing writes `[]`. */
export function clearGeneratedRecipeUnread(
  queryClient: QueryClient,
  recipeId: number,
): void {
  const ids = getUnreadGeneratedRecipeIds(queryClient);
  if (!ids.includes(recipeId)) return;
  queryClient.setQueryData<number[]>(
    UNREAD_GENERATED_RECIPES_KEY,
    ids.filter((id) => id !== recipeId),
  );
}

/** Drop every unread mark (the user opened Saved items). */
export function clearAllGeneratedRecipesUnread(queryClient: QueryClient): void {
  if (getUnreadGeneratedRecipeIds(queryClient).length === 0) return;
  queryClient.setQueryData<number[]>(UNREAD_GENERATED_RECIPES_KEY, []);
}

function getPendingGeneration(queryClient: QueryClient): PendingGeneration {
  return (
    queryClient.getQueryData<PendingGeneration>(
      PENDING_RECIPE_GENERATION_KEY,
    ) ?? {}
  );
}

/** Flag one entry point's generation as in flight (or finished). */
export function setPendingGeneration(
  queryClient: QueryClient,
  entry: GenerationEntry,
  pending: boolean,
): void {
  pinSentinelKeys(queryClient);
  queryClient.setQueryData<PendingGeneration>(PENDING_RECIPE_GENERATION_KEY, {
    ...getPendingGeneration(queryClient),
    [entry]: pending,
  });
}

export function isPendingGeneration(
  queryClient: QueryClient,
  entry: GenerationEntry,
): boolean {
  return getPendingGeneration(queryClient)[entry] ?? false;
}

type GeneratedRecipeReadyListener = (recipeId: number) => void;

const generatedRecipeReadyListeners = new Set<GeneratedRecipeReadyListener>();

/**
 * Subscribe to "a generated recipe landed" events. A module-level emitter
 * (same shape as `subscribeToCoachReplyReady`) because the request completes
 * after the sheet that started it has unmounted. Returns an unsubscribe
 * function.
 */
export function subscribeToGeneratedRecipeReady(
  listener: GeneratedRecipeReadyListener,
): () => void {
  generatedRecipeReadyListeners.add(listener);
  return () => {
    generatedRecipeReadyListeners.delete(listener);
  };
}

/**
 * A generation finished and the server saved the recipe: record the unread
 * mark (Profile dot) and tell subscribers (toast). Call only for a confirmed
 * save, and only for a request that belongs to the CURRENT session — the
 * caller compares the token it submitted with before calling this.
 */
export function noteGeneratedRecipeReady(
  queryClient: QueryClient,
  recipeId: number,
): void {
  markGeneratedRecipeUnread(queryClient, recipeId);
  generatedRecipeReadyListeners.forEach((listener) => listener(recipeId));
}

// Module-level so `useQuery` keeps one `select` identity across renders.
const selectHasUnread = (ids: number[]): boolean => ids.length > 0;

/**
 * True while any generated recipe is unopened. `skipToken` keeps this
 * cache-only key from ever being fetched; `select` collapses the ids to a
 * boolean so the tab bar re-renders only when the answer flips.
 */
export function useHasUnreadGeneratedRecipe(): boolean {
  const { data } = useQuery<number[], Error, boolean>({
    queryKey: UNREAD_GENERATED_RECIPES_KEY,
    queryFn: skipToken,
    gcTime: Infinity,
    select: selectHasUnread,
  });
  return data ?? false;
}

// One selector per entry so `useQuery` sees a stable `select` identity.
const selectPendingByEntry: Record<
  GenerationEntry,
  (pending: PendingGeneration) => boolean
> = {
  photo: (pending) => pending.photo ?? false,
  mealPlan: (pending) => pending.mealPlan ?? false,
};

/** True while `entry`'s generation is in flight (disables its Generate button). */
export function usePendingGeneration(entry: GenerationEntry): boolean {
  const { data } = useQuery<PendingGeneration, Error, boolean>({
    queryKey: PENDING_RECIPE_GENERATION_KEY,
    queryFn: skipToken,
    gcTime: Infinity,
    select: selectPendingByEntry[entry],
  });
  return data ?? false;
}
