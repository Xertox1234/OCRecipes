import { useCallback, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useToast } from "@/context/ToastContext";
import { useMakeSuggestion } from "@/hooks/useInspiredSuggestions";
import { ApiError } from "@/lib/api-error";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/**
 * "Make this mine" on an idea card: generate the recipe, then open it.
 * Shared by every surface that shows idea cards, so the single-flight guard
 * and the error copy have one owner. `onExpired` runs on a 410 — each caller
 * decides what an expired idea list means on its screen.
 */
export function useMakeSuggestionFlow() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const { mutateAsync: makeSuggestion } = useMakeSuggestion();
  // The idea card whose recipe is being made; one make at a time.
  const [makingId, setMakingId] = useState<number | null>(null);
  const makingRef = useRef<number | null>(null);

  const make = useCallback(
    (id: number, onExpired?: () => void) => {
      // One make at a time — a second card's tap is ignored while one runs.
      // A ref, not state: two taps in the same frame must not both pass.
      if (makingRef.current !== null) return;
      makingRef.current = id;
      setMakingId(id);
      makeSuggestion(id)
        .then(({ recipeId }) => {
          navigation.navigate("FeaturedRecipeDetail", {
            recipeId,
            recipeType: "community",
          });
        })
        .catch((error: unknown) => {
          // The toast announces itself for screen readers.
          const status = error instanceof ApiError ? error.status : undefined;
          if (status === 429) {
            toast.error("You've reached today's recipe limit.");
          } else if (status === 410) {
            toast.error("These ideas expired — search again.");
            onExpired?.();
          } else {
            toast.error("Couldn't make this recipe. Try again.");
          }
        })
        .finally(() => {
          if (makingRef.current === id) makingRef.current = null;
          setMakingId((current) => (current === id ? null : current));
        });
    },
    [makeSuggestion, navigation, toast],
  );

  return { make, makingId };
}
