import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { catalogConfigResponseSchema } from "@shared/types/recipe-catalog";

/**
 * Reports whether this deployment has the online recipe catalog configured
 * (server has SPOONACULAR_API_KEY). Used to hide the "Search online" CTA when
 * the catalog is unavailable. Deployment config is stable at runtime → cached
 * indefinitely (one fetch per app session).
 */
export function useCatalogConfig() {
  return useQuery({
    queryKey: ["/api/meal-plan/catalog/config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/meal-plan/catalog/config");
      const json = await res.json();
      const parsed = catalogConfigResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError(
          `Unexpected /api/meal-plan/catalog/config response shape: ${JSON.stringify(
            parsed.error.flatten(),
          )}`,
          "INVALID_RESPONSE_SHAPE",
        );
      }
      return parsed.data;
    },
    staleTime: Infinity,
  });
}
