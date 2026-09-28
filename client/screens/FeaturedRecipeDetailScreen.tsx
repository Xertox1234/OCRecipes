import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { EmptyState } from "@/components/EmptyState";
import { RecipeDetailContent } from "@/components/RecipeDetailContent";
import { RecipeDetailSkeleton } from "@/components/recipe-detail";
import { InlineError } from "@/components/InlineError";
import { ThemedText } from "@/components/ThemedText";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { IngredientItem } from "@/components/recipe-detail";
import {
  formatTimeDisplay,
  parseNutritionData,
} from "@/components/recipe-detail/recipe-detail-utils";
import {
  apiRequest,
  resolveImageUrl,
  shouldSurfaceQueryError,
} from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/context/ToastContext";
import { useSaveCatalogRecipe } from "@/hooks/useMealPlanRecipes";
import {
  catalogSaveErrorMessage,
  normalizeCatalogDetail,
  resolveFeaturedRecipeType,
  type CatalogDetailResponse,
} from "@/screens/featured-recipe-detail-utils";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import { safeGoBack } from "@/navigation/safeGoBack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { FeaturedRecipeDetailScreenNavigationProp } from "@/types/navigation";
import type {
  CommunityRecipe,
  MealPlanRecipe,
  RecipeIngredient,
} from "@shared/schema";
import type { DerivedRecipeAllergen } from "@shared/constants/allergens";
import { ErrorCode } from "@shared/constants/error-codes";

const HANDLE_WIDTH = 36;
const HANDLE_HEIGHT = 5;
const SAVE_BAR_HEIGHT = 72;

type FeaturedRecipeDetailRouteProp = RouteProp<
  RootStackParamList,
  "FeaturedRecipeDetail"
>;

type MealPlanRecipeWithIngredients = MealPlanRecipe & {
  ingredients: RecipeIngredient[];
};

interface NormalizedRecipe {
  title: string;
  description?: string | null;
  difficulty?: string | null;
  timeDisplay?: string | null;
  servings?: number | null;
  dietTags: string[];
  instructions: string[];
  ingredients: IngredientItem[];
  imageUrl?: string | null;
  nutrition?: ReturnType<typeof parseNutritionData>;
  allergens?: DerivedRecipeAllergen[] | null;
  remixedFromId?: number | null;
  remixedFromTitle?: string | null;
  // Curated recipe fields
  isCanonical?: boolean;
  canonicalImages?: string[] | null;
  instructionDetails?: (string | null)[] | null;
  toolsRequired?: { name: string; affiliateUrl?: string }[] | null;
  chefTips?: string[] | null;
  cuisineOrigin?: string | null;
}

export default function FeaturedRecipeDetailScreen() {
  const route = useRoute<FeaturedRecipeDetailRouteProp>();
  const { recipeId, recipeType, type } = route.params;
  const resolvedRecipeType = resolveFeaturedRecipeType(recipeType, type);
  const navigation = useNavigation<FeaturedRecipeDetailScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const toast = useToast();

  // --- Community recipe fetch ---
  const {
    data: communityRecipe,
    isLoading: communityLoading,
    error: communityError,
    refetch: refetchCommunityRecipe,
  } = useQuery<CommunityRecipe>({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: resolvedRecipeType === "community" && recipeId > 0,
  });

  // --- Meal plan recipe fetch ---
  const {
    data: mealPlanRecipe,
    isLoading: mealPlanLoading,
    error: mealPlanError,
    refetch: refetchMealPlanRecipe,
  } = useQuery<MealPlanRecipeWithIngredients>({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/recipes/${recipeId}`);
      return res.json();
    },
    enabled: resolvedRecipeType === "mealPlan" && recipeId > 0,
    // This screen renders its own error UI for this query, and the key has no
    // other live reader (useMealPlanRecipeDetail has no production call site),
    // so opt out of the global error toast — no double error surface. NOT set
    // on the community query above: RecipeChatScreen shares that key with no
    // error UI of its own and relies on the global toast.
    meta: { silentError: true },
  });

  // --- Catalog (Spoonacular) preview — nothing is saved until Save ---
  const {
    data: catalogDetail,
    isLoading: catalogLoading,
    error: catalogError,
    refetch: refetchCatalogDetail,
  } = useQuery<CatalogDetailResponse>({
    queryKey: ["/api/meal-plan/catalog", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/catalog/${recipeId}`);
      return res.json();
    },
    enabled: resolvedRecipeType === "catalog" && recipeId > 0,
    // This screen renders its own 403/404/402/generic states for this query.
    meta: { silentError: true },
  });
  const { mutateAsync: saveCatalogRecipe, isPending: isSavingCatalog } =
    useSaveCatalogRecipe();
  const [savedRecipeId, setSavedRecipeId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // --- Normalize into RecipeDetailContent props ---
  const normalized = useMemo((): NormalizedRecipe | null => {
    if (resolvedRecipeType === "catalog") {
      if (!catalogDetail) return null;
      return {
        ...normalizeCatalogDetail(catalogDetail),
        allergens: null,
        isCanonical: false,
        canonicalImages: [],
        instructionDetails: [],
        toolsRequired: [],
        chefTips: [],
        cuisineOrigin: null,
      };
    }

    if (resolvedRecipeType === "mealPlan" && mealPlanRecipe) {
      return {
        title: mealPlanRecipe.title,
        description: mealPlanRecipe.description,
        difficulty: mealPlanRecipe.difficulty,
        timeDisplay: formatTimeDisplay(
          mealPlanRecipe.prepTimeMinutes,
          mealPlanRecipe.cookTimeMinutes,
        ),
        servings: mealPlanRecipe.servings,
        dietTags: mealPlanRecipe.dietTags ?? [],
        instructions: mealPlanRecipe.instructions ?? [],
        ingredients: mealPlanRecipe.ingredients as IngredientItem[],
        imageUrl: mealPlanRecipe.imageUrl,
        nutrition: parseNutritionData(mealPlanRecipe),
        allergens: mealPlanRecipe.allergens,
        isCanonical: false,
        canonicalImages: [],
        instructionDetails: [],
        toolsRequired: [],
        chefTips: [],
        cuisineOrigin: null,
      };
    }

    if (communityRecipe) {
      return {
        title: communityRecipe.title,
        description: communityRecipe.description,
        difficulty: communityRecipe.difficulty,
        timeDisplay: communityRecipe.timeEstimate,
        servings: communityRecipe.servings,
        dietTags: communityRecipe.dietTags ?? [],
        instructions: communityRecipe.instructions ?? [],
        ingredients: (communityRecipe.ingredients ?? []) as IngredientItem[],
        imageUrl: communityRecipe.imageUrl,
        allergens: communityRecipe.allergens,
        remixedFromId: communityRecipe.remixedFromId,
        remixedFromTitle: communityRecipe.remixedFromTitle,
        isCanonical: communityRecipe.isCanonical,
        canonicalImages: (communityRecipe.canonicalImages as string[]) ?? [],
        instructionDetails:
          (communityRecipe.instructionDetails as (string | null)[]) ?? [],
        toolsRequired:
          (communityRecipe.toolsRequired as {
            name: string;
            affiliateUrl?: string;
          }[]) ?? [],
        chefTips: (communityRecipe.chefTips as string[]) ?? [],
        cuisineOrigin: communityRecipe.cuisineOrigin ?? null,
      };
    }

    return null;
  }, [resolvedRecipeType, catalogDetail, mealPlanRecipe, communityRecipe]);

  const isLoading =
    resolvedRecipeType === "catalog"
      ? catalogLoading
      : resolvedRecipeType === "community"
        ? communityLoading
        : mealPlanLoading;
  const error =
    resolvedRecipeType === "catalog"
      ? catalogError
      : resolvedRecipeType === "community"
        ? communityError
        : mealPlanError;
  const refetch =
    resolvedRecipeType === "catalog"
      ? refetchCatalogDetail
      : resolvedRecipeType === "community"
        ? refetchCommunityRecipe
        : refetchMealPlanRecipe;
  // A genuine 404 means the recipe doesn't exist — retrying won't help, and
  // labeling it a generic failure would assert a false cause (see
  // docs/solutions/logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md).
  // Any other error (network, 5xx, etc.) gets a generic message + retry.
  // Branching on the machine-readable `code` (not the message string or the
  // numeric status) matches the established convention — see
  // client/screens/meal-plan/GroceryListScreen.tsx and
  // client/screens/LabelAnalysisScreen.tsx.
  const isNotFoundError =
    error instanceof ApiError && error.code === ErrorCode.NOT_FOUND;
  // Like showsGenericError, a failed REFETCH over cached data keeps showing
  // the recipe (and its Save bar) rather than swapping in a wall under it.
  const isPremiumDenied =
    error instanceof ApiError &&
    error.code === ErrorCode.PREMIUM_REQUIRED &&
    !normalized;
  const isCatalogUnavailable =
    error instanceof ApiError &&
    error.code === ErrorCode.CATALOG_QUOTA_EXCEEDED &&
    !normalized;
  const showsGenericError =
    Boolean(error) &&
    !isNotFoundError &&
    !isPremiumDenied &&
    !isCatalogUnavailable &&
    !normalized;

  // Announce whichever EmptyState branch (below) is about to render — it has
  // no live region either. Skip the mount render so a screen that opens
  // already-errored/not-found doesn't announce on top of focus.
  //
  // The community query keeps the global error toast (see its useQuery), and
  // Toast.tsx announces its message in the same commit — iOS drops one of
  // two same-commit announcements. So when the toast will surface this error
  // (per the net's own predicate), stay quiet and let it speak; a 404 is
  // suppressed by the net, so "Recipe not found." is still announced here.
  const toastAnnouncesError =
    resolvedRecipeType === "community" &&
    Boolean(communityError) &&
    shouldSurfaceQueryError(communityError, undefined);
  const announcement = isLoading
    ? null
    : isPremiumDenied
      ? "Online recipes are a Premium feature."
      : isCatalogUnavailable
        ? "Spoonacular isn't available right now."
        : showsGenericError
          ? toastAnnouncesError
            ? null
            : "Couldn't load this recipe. Try again."
          : !normalized
            ? "Recipe not found."
            : null;
  const errorAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!errorAnnouncedRef.current) {
      errorAnnouncedRef.current = true;
      return;
    }
    if (announcement) {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [announcement]);

  const imageUri = useMemo(
    () => resolveImageUrl(normalized?.imageUrl),
    [normalized?.imageUrl],
  );

  // The save mutation is silentError (no global toast), so a failure that
  // lands after the user closed the preview would otherwise vanish.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const catalogTitle = normalized?.title;
  const handleSaveCatalog = useCallback(async () => {
    setSaveError(null);
    try {
      const saved = await saveCatalogRecipe(recipeId);
      setSavedRecipeId(saved.id);
      AccessibilityInfo.announceForAccessibility("Recipe saved");
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.PREMIUM_REQUIRED) {
        setShowUpgrade(true);
        return;
      }
      const { message, retryable } = catalogSaveErrorMessage(err);
      if (!isMountedRef.current) {
        toast.error(
          `Couldn't save ${catalogTitle ?? "the recipe"}. ${
            retryable ? "Try again." : message
          }`,
        );
        return;
      }
      setSaveError(message);
    }
  }, [saveCatalogRecipe, recipeId, toast, catalogTitle]);

  // After a purchase from the Premium wall, the 403'd preview must refetch —
  // the subscription refresh does not touch this query, and 4xx never retries.
  const handleUpgraded = useCallback(() => {
    if (resolvedRecipeType === "catalog") void refetchCatalogDetail();
  }, [resolvedRecipeType, refetchCatalogDetail]);

  const handleOpenSaved = useCallback(() => {
    if (savedRecipeId === null) return;
    navigation.replace("FeaturedRecipeDetail", {
      recipeId: savedRecipeId,
      recipeType: "mealPlan",
    });
  }, [navigation, savedRecipeId]);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
    >
      {/* Drag handle */}
      <View
        style={[styles.handleContainer, { top: insets.top + Spacing.xs }]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.handle,
            { backgroundColor: withOpacity(theme.text, 0.3) },
          ]}
        />
      </View>

      {/* Close button */}
      <Pressable
        onPress={() =>
          safeGoBack(navigation, () =>
            navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
          )
        }
        style={[
          styles.closeButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.7),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close recipe"
        hitSlop={12}
      >
        <Feather name="x" size={22} color={theme.text} />
      </Pressable>

      {isLoading ? (
        <ScrollView contentInsetAdjustmentBehavior="never">
          <RecipeDetailSkeleton />
        </ScrollView>
      ) : isPremiumDenied ? (
        <View style={styles.center}>
          <EmptyState
            variant="temporary"
            icon="lock"
            title="Online recipes are a Premium feature"
            description="Upgrade to preview and save Spoonacular recipes."
            actionLabel="See Premium"
            onAction={() => setShowUpgrade(true)}
          />
        </View>
      ) : isCatalogUnavailable ? (
        <View style={styles.center}>
          <EmptyState
            variant="temporary"
            icon="cloud-off"
            title="Spoonacular isn't available right now"
            description="Try again later, or pick a community recipe."
          />
        </View>
      ) : showsGenericError ? (
        <View style={styles.center}>
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load this recipe"
            description="Something went wrong. Check your connection and try again."
            actionLabel="Try Again"
            onAction={() => {
              void refetch();
            }}
          />
        </View>
      ) : !normalized ? (
        <View style={styles.center}>
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Recipe not found"
            description="This recipe may have been removed or is no longer available."
          />
        </View>
      ) : (
        <RecipeDetailContent
          // A catalog preview is not a row in our DB yet: recipeId 0 hides
          // the favourite/cookbook/remix affordances that key on it.
          recipeId={resolvedRecipeType === "catalog" ? 0 : recipeId}
          recipeType={
            resolvedRecipeType === "catalog" ? "mealPlan" : resolvedRecipeType
          }
          title={normalized.title}
          description={normalized.description}
          imageUrl={imageUri}
          timeDisplay={normalized.timeDisplay}
          difficulty={normalized.difficulty}
          servings={normalized.servings}
          dietTags={normalized.dietTags}
          nutrition={normalized.nutrition ?? null}
          allergens={normalized.allergens}
          ingredients={normalized.ingredients}
          instructions={normalized.instructions}
          contentPaddingBottom={
            insets.bottom +
            Spacing.xl +
            (resolvedRecipeType === "catalog" ? SAVE_BAR_HEIGHT : 0)
          }
          remixedFromId={normalized.remixedFromId}
          remixedFromTitle={normalized.remixedFromTitle}
          isCanonical={normalized.isCanonical}
          canonicalImages={normalized.canonicalImages}
          instructionDetails={normalized.instructionDetails}
          toolsRequired={normalized.toolsRequired}
          chefTips={normalized.chefTips}
          cuisineOrigin={normalized.cuisineOrigin}
        />
      )}
      {resolvedRecipeType === "catalog" && normalized ? (
        <View
          style={[
            styles.saveBar,
            {
              paddingBottom: insets.bottom + Spacing.sm,
              backgroundColor: theme.backgroundRoot,
            },
          ]}
        >
          <InlineError message={saveError} />
          <Pressable
            onPress={
              savedRecipeId !== null ? handleOpenSaved : handleSaveCatalog
            }
            disabled={isSavingCatalog}
            accessibilityRole="button"
            accessibilityLabel={
              savedRecipeId !== null
                ? `Saved. Open ${normalized.title} in your recipes`
                : `Save ${normalized.title} to your recipes`
            }
            accessibilityState={{
              disabled: isSavingCatalog,
              busy: isSavingCatalog,
            }}
            style={[styles.saveButton, { backgroundColor: theme.accentSolid }]}
          >
            <ThemedText style={{ color: theme.buttonText, fontWeight: "600" }}>
              {isSavingCatalog
                ? "Saving…"
                : savedRecipeId !== null
                  ? "Saved · View recipe"
                  : "Save to My Recipes"}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onUpgrade={handleUpgraded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
  },
  handle: {
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: HANDLE_HEIGHT / 2,
  },
  closeButton: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
