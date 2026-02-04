import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

interface InstructionsResponse {
  instructions: string;
}

interface UseSuggestionInstructionsParams {
  itemId: number;
  suggestionIndex: number;
  suggestionTitle: string;
  suggestionType: "recipe" | "craft" | "pairing";
  enabled: boolean;
}

/**
 * Hook to fetch detailed instructions for a suggestion.
 * Instructions are fetched on-demand when `enabled` is true.
 */
export function useSuggestionInstructions({
  itemId,
  suggestionIndex,
  suggestionTitle,
  suggestionType,
  enabled,
}: UseSuggestionInstructionsParams) {
  return useQuery<InstructionsResponse>({
    queryKey: [
      `/api/items/${itemId}/suggestions/${suggestionIndex}/instructions`,
      suggestionTitle,
    ],
    queryFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/items/${itemId}/suggestions/${suggestionIndex}/instructions`,
        { suggestionTitle, suggestionType },
      );
      return response.json();
    },
    enabled,
    staleTime: 30 * 60 * 1000, // Cache instructions for 30 minutes
  });
}
