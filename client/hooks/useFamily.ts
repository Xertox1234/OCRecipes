import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FamilyProfile } from "@shared/schema";
import {
  isFamilyPlanningActive,
  type FamilyProfileInput,
} from "@shared/types/family";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS, familyProfilesKey } from "@/lib/query-keys";
import { dietaryProfileQueryOptions } from "@/hooks/useDietaryProfile";
import { usePlanCheck } from "@/hooks/usePlanCheck";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";

const NO_PROFILES: FamilyProfile[] = [];

/**
 * Whether family planning is live, and the profiles when it is. The switch
 * comes from the dietary profile (the server returns the whole row, and that
 * query already exists); the list is only fetched while active, so a lapsed
 * or switched-off user never loads other people's data. An unknown plan is
 * neutral: inactive.
 */
export function useFamilyContext(): {
  active: boolean;
  profiles: FamilyProfile[];
  isLoading: boolean;
} {
  const flag = usePremiumFeature("familyProfiles");
  const { planUnknown } = usePlanCheck();
  const { data: dietaryProfile } = useQuery(dietaryProfileQueryOptions);

  const active =
    !planUnknown &&
    isFamilyPlanningActive({ familyProfiles: flag }, dietaryProfile);

  const list = useQuery({
    queryKey: familyProfilesKey(),
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", "/api/family-profiles", undefined, {
        signal,
      });
      return (await res.json()) as {
        enabled: boolean;
        profiles: FamilyProfile[];
      };
    },
    enabled: active,
  });

  return {
    active,
    profiles: active ? (list.data?.profiles ?? NO_PROFILES) : NO_PROFILES,
    isLoading: active && list.isLoading,
  };
}

function isMealPlanItemsQuery(query: { queryKey: readonly unknown[] }) {
  return query.queryKey[0] === "/api/meal-plan";
}

export function useSetFamilyPlanning() {
  const queryClient = useQueryClient();
  return useMutation<{ enabled: boolean }, Error, boolean>({
    mutationFn: async (enabled) => {
      const res = await apiRequest("PUT", "/api/family-planning", { enabled });
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.dietaryProfile,
      });
      void queryClient.invalidateQueries({ queryKey: familyProfilesKey() });
      void queryClient.invalidateQueries({ predicate: isMealPlanItemsQuery });
    },
  });
}

export function useCreateFamilyProfile() {
  const queryClient = useQueryClient();
  return useMutation<FamilyProfile, Error, FamilyProfileInput>({
    mutationFn: async (input) => {
      const res = await apiRequest("POST", "/api/family-profiles", input);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyProfilesKey() });
    },
  });
}

export function useUpdateFamilyProfile() {
  const queryClient = useQueryClient();
  return useMutation<
    FamilyProfile,
    Error,
    { id: number; input: FamilyProfileInput }
  >({
    mutationFn: async ({ id, input }) => {
      const res = await apiRequest("PUT", `/api/family-profiles/${id}`, input);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyProfilesKey() });
    },
  });
}

/** A deleted profile takes its meals with it, so the meal plan is stale too. */
export function useDeleteFamilyProfile() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      await apiRequest("DELETE", `/api/family-profiles/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyProfilesKey() });
      void queryClient.invalidateQueries({ predicate: isMealPlanItemsQuery });
    },
  });
}
