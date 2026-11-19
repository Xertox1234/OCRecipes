import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { getDeviceTimezone } from "@/lib/timezone";
import { setPendingAudience, takePendingAudience } from "@/lib/plan-audience";
import type { MealPlanItem } from "@shared/schema";
import type { CreateMealPlanRecipeInput } from "@/hooks/useMealPlanRecipes";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import type { MealAudience } from "@shared/types/family";

/** Invalidate only meal-plan item queries, not recipes/catalog queries.
 *  Item queries use key ["/api/meal-plan", startDate, endDate] while recipe
 *  queries use ["/api/meal-plan/recipes", ...] so an exact match on the first
 *  element is sufficient to distinguish them. */
export function invalidateMealPlanItems(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === "/api/meal-plan";
    },
  });
}

/**
 * How long after a save to look again for a recipe picture that is still
 * being generated. Generation takes a few seconds to about half a minute.
 */
export const PENDING_PICTURE_REFRESH_DELAYS_MS = [6_000, 15_000, 30_000];

/**
 * A recipe saved without a picture gets one generated in the background, after
 * the plan has already been refetched without it. Refetch the plan items a few
 * more times so the picture shows up on its own. Not tied to a component: the
 * sheet that calls this has closed by the time the picture lands. Returns a
 * cancel function.
 */
export function refreshMealPlanItemsForPendingPicture(
  queryClient: ReturnType<typeof useQueryClient>,
): () => void {
  const timers = PENDING_PICTURE_REFRESH_DELAYS_MS.map((delay) =>
    setTimeout(() => invalidateMealPlanItems(queryClient), delay),
  );
  return () => timers.forEach(clearTimeout);
}

/**
 * `enabled` lets a caller gate the request on something beyond having a
 * date range (e.g. a premium-feature check) without overloading `startDate`/
 * `endDate` to mean "off" via empty strings — see
 * P3-2026-08-30-coach-datesWithItems-fetches-eagerly-and-window-goes-stale.md.
 */
export function useMealPlanItems(
  startDate: string,
  endDate: string,
  enabled = true,
) {
  return useQuery<MealPlanItemWithRelations[]>({
    queryKey: ["/api/meal-plan", startDate, endDate],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/meal-plan?start=${startDate}&end=${endDate}`,
      );
      return res.json();
    },
    enabled: enabled && !!startDate && !!endDate,
  });
}

export function useAddMealPlanItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: {
      recipeId?: number | null;
      scannedItemId?: number | null;
      /** Create this recipe together with the plan item in one server call. */
      recipe?: Omit<CreateMealPlanRecipeInput, "sourceCommunityRecipeId">;
      plannedDate: string;
      mealType: string;
      servings?: string | number;
      /** Who the meal is for; left out, the add menu's choice for this slot applies. */
      audience?: MealAudience;
      familyProfileId?: number | null;
    }) => {
      // The add menu's "Who's it for?" for this slot, unless the caller named
      // an audience itself.
      const slot = { plannedDate: item.plannedDate, mealType: item.mealType };
      const pending =
        item.audience === undefined ? takePendingAudience(slot) : null;
      const res = await apiRequest(
        "POST",
        "/api/meal-plan/items",
        pending ? { ...item, ...pending } : item,
      ).catch((error: unknown) => {
        // The sheet stays open for a retry, which must still be for them.
        if (pending) setPendingAudience(slot, pending);
        throw error;
      });
      return (await res.json()) as MealPlanItem;
    },
    onSuccess: (_created, variables) => {
      invalidateMealPlanItems(queryClient);
      if (variables.recipe) {
        // An inline recipe was created too — keep the recipe lists fresh.
        void queryClient.invalidateQueries({
          queryKey: ["/api/meal-plan/recipes"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/recipes/browse"],
        });
      }
    },
    // Every call site (MealPlanHomeScreen, MealPlanDayScreen, RecipeBrowserScreen, WizardShell,
    // CoachChat, QuickAddSheet, SimpleEntrySheet) already toasts/alerts on
    // failure via a try/catch around mutateAsync.
    meta: { silentError: true },
  });
}

/** Changes who a planned meal is for (the day row's "Who's it for?"). */
export function useUpdateMealPlanItemAudience() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      audience,
      familyProfileId,
    }: {
      id: number;
      audience: MealAudience;
      familyProfileId: number | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/meal-plan/items/${id}`, {
        audience,
        familyProfileId,
      });
      return (await res.json()) as MealPlanItem;
    },
    onSuccess: () => {
      invalidateMealPlanItems(queryClient);
    },
    // Its one call site (MealPlanDayScreen) already toasts on failure.
    meta: { silentError: true },
  });
}

export function useRemoveMealPlanItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/meal-plan/items/${id}`);
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      invalidateMealPlanItems(queryClient);
    },
    // Its one call site (MealPlanDayScreen) already toasts on failure.
    meta: { silentError: true },
  });
}

export function useConfirmMealPlanItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      // X-Timezone is required here, not decorative: the server buckets the
      // duplicate-confirmation check by the civil day of the item's
      // `plannedDate` in THIS zone. `apiRequest` does not add the header
      // automatically — every caller passes it explicitly — so omitting it
      // silently falls back to UTC day bounds on the server.
      const res = await apiRequest(
        "POST",
        `/api/meal-plan/items/${id}/confirm`,
        undefined,
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return res.json();
    },
    onSuccess: () => {
      invalidateMealPlanItems(queryClient);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailyBudget });
    },
    // Its one call site (MealPlanDayScreen) already toasts on failure.
    meta: { silentError: true },
  });
}

export function useReorderMealPlanItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: { id: number; sortOrder: number }[]) => {
      const res = await apiRequest("PATCH", "/api/meal-plan/reorder", {
        items,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateMealPlanItems(queryClient);
    },
    // Its one call site (MealPlanDayScreen) already toasts on failure.
    meta: { silentError: true },
  });
}
