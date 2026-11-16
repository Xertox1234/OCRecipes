import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
 * The one owner of the profile-list query. `useFamilyContext` (only while
 * family planning is active) and `useFamilyProfilesList` (the management
 * screens, always) both spread it, so the two cannot drift: one key, one
 * queryFn. GET /api/family-profiles is not premium-gated on the server.
 */
export const familyProfilesQueryOptions = queryOptions({
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
});

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

  const list = useQuery({ ...familyProfilesQueryOptions, enabled: active });

  return {
    active,
    profiles: active ? (list.data?.profiles ?? NO_PROFILES) : NO_PROFILES,
    isLoading: active && list.isLoading,
  };
}

/**
 * The profile list for the screens that manage profiles. Unlike
 * `useFamilyContext` it loads whenever the screen is mounted, whatever the
 * plan or the switch: a lapsed-premium user still has to see their profiles to
 * delete them. Only mount it on those screens.
 */
export function useFamilyProfilesList(): {
  profiles: FamilyProfile[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const list = useQuery(familyProfilesQueryOptions);
  return {
    profiles: list.data?.profiles ?? NO_PROFILES,
    isLoading: list.isLoading,
    isError: list.isError,
    refetch: () => void list.refetch(),
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
