import { queryOptions } from "@tanstack/react-query";
import type { Allergy } from "@shared/schema";
import type { ReminderMutes } from "@shared/types/reminders";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";

/** GET /api/user/dietary-profile as the client reads it. */
export interface DietaryProfile {
  allergies?: Allergy[];
  healthConditions?: string[];
  dietType?: string | null;
  foodDislikes?: string[];
  primaryGoal?: string | null;
  activityLevel?: string | null;
  cuisinePreferences?: string[];
  cookingSkillLevel?: string | null;
  cookingTimeAvailable?: string | null;
  reminderMutes?: ReminderMutes;
}

/**
 * The one owner of the dietary-profile query. Every reader spreads it
 * (`useQuery({ ...dietaryProfileQueryOptions, select })`) rather than writing
 * its own queryFn: TanStack keeps ONE queryFn and ONE `meta` per cache entry,
 * taken from whichever observer set options last, so per-reader copies on a
 * shared key drift silently. The server answers `null` before a profile row
 * exists.
 */
export const dietaryProfileQueryOptions = queryOptions({
  queryKey: QUERY_KEYS.dietaryProfile,
  // Forwards TanStack's cancellation signal (unmount, key change), as the
  // global default fetcher does, so a cancelled read stops fetching.
  queryFn: async ({ signal }): Promise<DietaryProfile | null> => {
    const res = await apiRequest(
      "GET",
      "/api/user/dietary-profile",
      undefined,
      { signal },
    );
    return res.json();
  },
});
