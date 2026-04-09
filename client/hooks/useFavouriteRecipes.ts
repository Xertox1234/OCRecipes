import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Share, Platform } from "react-native";
import { apiRequest } from "@/lib/query-client";
import type { ResolvedFavouriteRecipe } from "@shared/schema";

const FAVOURITES_KEY = ["/api/favourite-recipes"];
const FAVOURITES_IDS_KEY = ["/api/favourite-recipes/ids"];

interface FavouriteId {
  recipeId: number;
  recipeType: string;
}

export function useFavouriteRecipes(limit?: number) {
  return useQuery<ResolvedFavouriteRecipe[]>({
    queryKey: limit ? [...FAVOURITES_KEY, { limit }] : FAVOURITES_KEY,
    queryFn: async () => {
      const url = limit
        ? `/api/favourite-recipes?limit=${limit}`
        : "/api/favourite-recipes";
      const res = await apiRequest("GET", url);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    refetchOnMount: "always",
  });
}

export function useFavouriteRecipeIds() {
  return useQuery<{ ids: FavouriteId[] }>({
    queryKey: FAVOURITES_IDS_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/favourite-recipes/ids");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    refetchOnMount: "always",
  });
}

export function useIsRecipeFavourited(
  recipeId: number,
  recipeType: "mealPlan" | "community",
): boolean {
  const { data } = useFavouriteRecipeIds();
  return useMemo(
    () =>
      data?.ids.some(
        (f) => f.recipeId === recipeId && f.recipeType === recipeType,
      ) ?? false,
    [data, recipeId, recipeType],
  );
}

export function useToggleFavouriteRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recipeId,
      recipeType,
    }: {
      recipeId: number;
      recipeType: "mealPlan" | "community";
    }) => {
      const res = await apiRequest("POST", "/api/favourite-recipes/toggle", {
        recipeId,
        recipeType,
      });
      if (res.status === 403) {
        const body = await res.json();
        throw new Error(
          body.code === "LIMIT_REACHED" ? "LIMIT_REACHED" : body.error,
        );
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<{ favourited: boolean }>;
    },
    onMutate: async ({ recipeId, recipeType }) => {
      await queryClient.cancelQueries({ queryKey: FAVOURITES_IDS_KEY });
      const previous = queryClient.getQueryData<{ ids: FavouriteId[] }>(
        FAVOURITES_IDS_KEY,
      );
      queryClient.setQueryData<{ ids: FavouriteId[] }>(
        FAVOURITES_IDS_KEY,
        (old) => {
          if (!old) return { ids: [{ recipeId, recipeType }] };
          const exists = old.ids.some(
            (f) => f.recipeId === recipeId && f.recipeType === recipeType,
          );
          if (exists) {
            return {
              ids: old.ids.filter(
                (f) =>
                  !(f.recipeId === recipeId && f.recipeType === recipeType),
              ),
            };
          }
          return { ids: [...old.ids, { recipeId, recipeType }] };
        },
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(FAVOURITES_IDS_KEY, context.previous);
      }
      if (error.message === "LIMIT_REACHED") {
        Alert.alert(
          "Favourites Limit Reached",
          "Upgrade to premium for unlimited favourites.",
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: FAVOURITES_IDS_KEY });
      queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY });
    },
  });
}

export function useShareRecipe() {
  const share = useCallback(
    async (recipeId: number, recipeType: "mealPlan" | "community") => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/recipes/${recipeType}/${recipeId}/share`,
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const payload: {
          title: string;
          description: string;
          imageUrl: string | null;
          deepLink: string;
        } = await res.json();

        const message = `Check out this recipe: ${payload.title}\n\n${payload.description ?? ""}\n\n${payload.deepLink}`;

        await Share.share(
          Platform.OS === "ios"
            ? {
                title: payload.title,
                message,
                url: payload.imageUrl ?? undefined,
              }
            : { title: payload.title, message },
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("User did not share")
        )
          return;
        Alert.alert("Share Failed", "Could not share this recipe.");
      }
    },
    [],
  );
  return { share };
}
