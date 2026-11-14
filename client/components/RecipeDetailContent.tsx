import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { CookbookPickerModal } from "@/components/CookbookPickerModal";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  NutritionCard,
  RecipeMetaChips,
  RecipeIngredientsList,
  RecipeDietTags,
  FoodFacts,
  RecipeInstructions,
} from "@/components/recipe-detail";
import { AskCoachSection } from "@/components/AskCoachSection";
import { RecipeCommunityStats } from "@/components/RecipeCommunityStats";
import { RecipeAttributeRow } from "@/components/RecipeAttributeRow";
import type { NutritionData, IngredientItem } from "@/components/recipe-detail";
import {
  toDisplayedDietTags,
  uniqueTagsIgnoringCase,
} from "@/components/recipe-detail/recipe-detail-utils";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAllergenCheck } from "@/hooks/useAllergenCheck";
import { useIsRecipeFavourited } from "@/hooks/useFavouriteRecipes";
import { useServingAdjuster } from "@/hooks/useServingAdjuster";
import { RecipeActionBar } from "@/components/RecipeActionBar";
import { usePremiumContext } from "@/context/PremiumContext";
import { useToast } from "@/context/ToastContext";
import { resolveImageUrl } from "@/lib/query-client";
import { logger } from "@/lib/logger";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { DerivedRecipeAllergen } from "@shared/constants/allergens";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  withOpacity,
} from "@/constants/theme";

const CURATED_STEP_HINT_KEY = "curated_step_hint_shown";

const HERO_IMAGE_HEIGHT = 250;
const HERO_PLACEHOLDER_HEIGHT = 200;

export interface RecipeDetailContentProps {
  /** Called with the outer scroll offset (JS thread, throttled). Lets a host that
   *  floats controls over the hero draw a backing band once content scrolls. */
  onScrollOffset?: (y: number) => void;
  recipeId: number;
  recipeType: "mealPlan" | "community";
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  timeDisplay?: string | null;
  difficulty?: string | null;
  servings?: number | null;
  dietTags?: string[];
  nutrition?: NutritionData | null;
  ingredients?: IngredientItem[];
  instructions?: string[] | null;
  contentPaddingTop?: number;
  contentPaddingBottom?: number;
  /**
   * Recipe's own derived allergen cache — universal, NOT filtered by the
   * viewer's declared allergies. Renders the "Contains: <allergens>" label.
   */
  allergens?: DerivedRecipeAllergen[] | null;
  /**
   * Derived diet-conflict cache (stored jsonb, read defensively). `null` =
   * not checked, so no diet icon shows.
   */
  dietConflicts?: unknown;
  /** AI-set heat level (stored text, read defensively); `null` = no icon. */
  spiceLevel?: unknown;
  /** `toTotalTimeMinutes` of the recipe; drives the Quick icon. */
  totalTimeMinutes?: number | null;
  /** ID of the recipe this was remixed from (null if original was deleted) */
  remixedFromId?: number | null;
  /** Title snapshot of the original recipe (preserved even if original is deleted) */
  remixedFromTitle?: string | null;
  // --- Curated recipe fields ---
  isCanonical?: boolean;
  canonicalImages?: string[] | null;
  instructionDetails?: (string | null)[] | null;
  toolsRequired?: { name: string; affiliateUrl?: string }[] | null;
  chefTips?: string[] | null;
  cuisineOrigin?: string | null;
}

/** The recipe's own content — what a host normalizes from its source row. */
export type RecipeDetailData = Omit<
  RecipeDetailContentProps,
  | "onScrollOffset"
  | "recipeId"
  | "recipeType"
  | "contentPaddingTop"
  | "contentPaddingBottom"
>;

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function RecipeDetailContent(props: RecipeDetailContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<NavProp>();
  const { isPremium, isPremiumResolved, refreshSubscription } =
    usePremiumContext();
  const { width: screenWidth } = useWindowDimensions();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [hasShownHint, setHasShownHint] = useState(true);

  useEffect(() => {
    if (props.isCanonical) {
      AsyncStorage.getItem(CURATED_STEP_HINT_KEY)
        .then((v) => {
          if (!v) setHasShownHint(false);
        })
        .catch((err) => logger.error("Failed to read curated step hint", err));
    }
  }, [props.isCanonical]);

  // Another recipe starts with every step collapsed (set during render when
  // the id changes — React's "adjust state when a prop changes" pattern).
  const [prevRecipeId, setPrevRecipeId] = useState(props.recipeId);
  if (props.recipeId !== prevRecipeId) {
    setPrevRecipeId(props.recipeId);
    setExpandedStep(null);
  }

  const hasShownHintRef = useRef(hasShownHint);
  useEffect(() => {
    hasShownHintRef.current = hasShownHint;
  }, [hasShownHint]);

  const handleStepLongPress = useCallback((index: number) => {
    setExpandedStep((prev) => (prev === index ? null : index));
    if (!hasShownHintRef.current) {
      setHasShownHint(true);
      AsyncStorage.setItem(CURATED_STEP_HINT_KEY, "1").catch((err) =>
        logger.error("Failed to persist curated step hint", err),
      );
    }
  }, []); // stable reference — reads hasShownHint via ref

  const {
    servingCount,
    scaledIngredients,
    isAdjusted,
    increment,
    decrement,
    setServings,
  } = useServingAdjuster(props.servings ?? 1, props.ingredients ?? []);

  const isCommunityRecipe = props.recipeType === "community";
  const isFavourited = useIsRecipeFavourited(props.recipeId, props.recipeType);

  const handleRemixPress = useCallback(() => {
    // Status unknown (loading or failed): re-check instead of walling a user
    // who may be paying (audit 2026-10-29 M-crel-6).
    if (!isPremiumResolved) {
      void refreshSubscription();
      toast.info("Checking your plan. Try again in a moment.");
      return;
    }
    if (!isPremium) {
      setShowUpgrade(true);
      return;
    }
    haptics.impact();
    navigation.navigate("RecipeChat", {
      remixSourceRecipeId: props.recipeId,
      remixSourceRecipeTitle: props.title,
    });
  }, [
    isPremium,
    isPremiumResolved,
    refreshSubscription,
    toast,
    haptics,
    navigation,
    props.recipeId,
    props.title,
  ]);

  // Allergen checking — short-circuits when ingredients is empty (enabled: length > 0)
  const ingredientNames = useMemo(
    () => (props.ingredients ?? []).map((i) => i.name),
    [props.ingredients],
  );
  const {
    data: allergenResult,
    isError: allergenCheckFailed,
    refetch: refetchAllergenCheck,
  } = useAllergenCheck(ingredientNames);

  const uniqueTags = useMemo(
    () => uniqueTagsIgnoringCase(props.dietTags ?? []),
    [props.dietTags],
  );
  // Checkable diets show only as checked icons (RecipeAttributeRow); the
  // rest stay text chips. The coach context below still gets every tag.
  const displayedTags = toDisplayedDietTags(uniqueTags);

  const recipeCoachQuestions = useMemo(
    () => [
      {
        text: "What side dishes pair well?",
        question: `What side dishes would pair well with ${props.title}?`,
      },
      {
        text: "How can I make this healthier?",
        question: `How can I modify ${props.title} to make it healthier while keeping it tasty?`,
      },
      ...(isCommunityRecipe
        ? [
            {
              text: "Remix this recipe",
              question: "__remix__",
            },
          ]
        : [
            {
              text: "Can I substitute an ingredient?",
              question: `What ingredient substitutions would work for ${props.title}?`,
            },
          ]),
      {
        text: "How do I store leftovers?",
        question: `What's the best way to store and reheat leftovers from ${props.title}?`,
      },
    ],
    [props.title, isCommunityRecipe],
  );

  const recipeCoachContext = useMemo(
    () =>
      `User is viewing recipe: ${props.title}${ingredientNames.length ? `\nIngredients: ${ingredientNames.join(", ")}` : ""}${uniqueTags.length ? `\nDiet tags: ${uniqueTags.join(", ")}` : ""}`,
    [props.title, ingredientNames, uniqueTags],
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={{
          paddingTop: props.contentPaddingTop ?? 0,
          paddingBottom: props.contentPaddingBottom ?? Spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        onScroll={
          props.onScrollOffset
            ? (e) => props.onScrollOffset?.(e.nativeEvent.contentOffset.y)
            : undefined
        }
        scrollEventThrottle={16}
      >
        {/* 1. Hero Image / Gallery */}
        {props.isCanonical && (props.canonicalImages?.length ?? 0) > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
          >
            {props.canonicalImages!.map((url, i) => (
              <Image
                key={`img-${i}`}
                source={{ uri: resolveImageUrl(url) ?? undefined }}
                style={{ width: screenWidth, height: HERO_IMAGE_HEIGHT }}
                contentFit="cover"
                accessibilityLabel={`Photo ${i + 1} of ${props.canonicalImages!.length} of ${props.title}`}
              />
            ))}
          </ScrollView>
        ) : (
          <FallbackImage
            source={{ uri: props.imageUrl ?? undefined }}
            style={styles.heroImage}
            fallbackStyle={{
              backgroundColor: theme.backgroundSecondary,
              height: HERO_PLACEHOLDER_HEIGHT,
            }}
            fallbackIcon="image"
            fallbackIconSize={48}
            resizeMode="cover"
            // Decorative: the recipe title is announced by the <h3> just
            // below, so labelling the hero image only repeats it.
          />
        )}

        <View style={styles.content}>
          {/* 2. Title + Description */}
          <ThemedText type="h3" style={styles.title}>
            {props.title}
          </ThemedText>

          {/* 2a. Checked attribute icons + universal allergen label —
              profile-independent, distinct from the personalized
              AllergenWarningBanner further down. */}
          <RecipeAttributeRow
            facts={{
              dietTags: props.dietTags,
              allergens: props.allergens,
              dietConflicts: props.dietConflicts,
              spiceLevel: props.spiceLevel,
              totalTimeMinutes: props.totalTimeMinutes,
            }}
          />

          {/* 2b. Remix lineage */}
          {props.remixedFromTitle && (
            <Pressable
              onPress={
                props.remixedFromId
                  ? () =>
                      navigation.navigate("FeaturedRecipeDetail", {
                        recipeId: props.remixedFromId!,
                        recipeType: "community",
                      })
                  : undefined
              }
              disabled={!props.remixedFromId}
              style={styles.lineageRow}
              accessibilityRole={props.remixedFromId ? "link" : "text"}
              accessibilityLabel={`Remixed from ${props.remixedFromTitle}`}
            >
              <Ionicons
                name="shuffle-outline"
                size={12}
                color={theme.textSecondary}
              />
              <ThemedText
                style={[
                  styles.lineageText,
                  {
                    color: props.remixedFromId
                      ? theme.link
                      : theme.textSecondary,
                  },
                ]}
                numberOfLines={1}
              >
                Remixed from {props.remixedFromTitle}
              </ThemedText>
            </Pressable>
          )}

          {props.description && (
            <ThemedText
              style={[styles.description, { color: theme.textSecondary }]}
            >
              {props.description}
            </ThemedText>
          )}

          {/* 3. Meta Pills */}
          <RecipeMetaChips
            timeDisplay={props.timeDisplay}
            difficulty={props.difficulty}
            servings={props.servings}
            servingCount={servingCount}
            isAdjusted={isAdjusted}
            onIncrement={increment}
            onDecrement={decrement}
            onSetServings={setServings}
          />

          {/* 4. Action Bar (Favourite, Share, Save to Cookbook) */}
          {props.recipeId > 0 && (
            <RecipeActionBar
              recipeId={props.recipeId}
              recipeType={props.recipeType}
              isFavourited={isFavourited}
              onSaveToCookbook={() => setPickerVisible(true)}
            />
          )}

          {/* 4b. Remix Button (community recipes only) */}
          {isCommunityRecipe && props.recipeId > 0 && (
            <Pressable
              onPress={handleRemixPress}
              style={[
                styles.saveButton,
                { backgroundColor: withOpacity(theme.link, 0.1) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Remix this recipe"
              accessibilityHint="Opens a guided flow to modify this recipe"
            >
              <Ionicons name="shuffle-outline" size={14} color={theme.link} />
              <ThemedText
                style={[styles.saveButtonText, { color: theme.link }]}
              >
                Remix Recipe
              </ThemedText>
            </Pressable>
          )}

          {/* 5. Diet Tags */}
          {displayedTags.length > 0 && <RecipeDietTags tags={displayedTags} />}

          {/* 6. Nutrition (conditional) */}
          {props.nutrition && <NutritionCard nutrition={props.nutrition} />}

          {/* 7. Ingredients (conditional) */}
          {scaledIngredients.length > 0 && (
            <RecipeIngredientsList
              ingredients={scaledIngredients}
              allergenResult={allergenResult}
              allergenCheckFailed={allergenCheckFailed}
              onRetryAllergenCheck={() => {
                void refetchAllergenCheck();
              }}
            />
          )}
        </View>

        {/* 8. Food Facts (outside content padding — components handle own padding) */}
        <FoodFacts ingredientNames={ingredientNames} />

        {/* 9. Instructions — curated recipes get expandable steps, the hold
            hint and Tools Required */}
        <RecipeInstructions
          instructions={props.instructions ?? []}
          expandable={
            props.isCanonical
              ? {
                  details: props.instructionDetails,
                  expandedStep,
                  onToggleStep: handleStepLongPress,
                  showHint: !hasShownHint,
                }
              : undefined
          }
        >
          {/* Tools Required (curated only) */}
          {props.isCanonical && (props.toolsRequired?.length ?? 0) > 0 && (
            <View style={styles.toolsSection}>
              <ThemedText type="h4" style={styles.toolsSectionTitle}>
                Tools Required
              </ThemedText>
              {props.toolsRequired!.map((tool, i) => (
                <Pressable
                  key={i}
                  onPress={
                    tool.affiliateUrl
                      ? () => {
                          WebBrowser.openBrowserAsync(tool.affiliateUrl!).catch(
                            () => {
                              toast.error(
                                "Couldn't open link. Please try again.",
                              );
                            },
                          );
                        }
                      : undefined
                  }
                  style={styles.toolRow}
                  accessibilityRole={tool.affiliateUrl ? "link" : "text"}
                  accessibilityLabel={
                    tool.affiliateUrl ? `${tool.name}, tap to view` : tool.name
                  }
                >
                  <ThemedText style={styles.toolName}>{tool.name}</ThemedText>
                  {tool.affiliateUrl && (
                    <Feather
                      name="external-link"
                      size={14}
                      color={theme.textSecondary}
                    />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </RecipeInstructions>

        {/* 9b. Chef's Notes (curated only) */}
        {props.isCanonical &&
          ((props.chefTips?.length ?? 0) > 0 || props.cuisineOrigin) && (
            <View
              style={[
                styles.chefCard,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              accessibilityRole="summary"
              accessibilityLabel="Chef's notes"
            >
              <ThemedText type="h4" style={styles.chefCardTitle}>
                {"Chef's Notes"}
              </ThemedText>
              {props.cuisineOrigin && (
                <ThemedText
                  style={[styles.cuisineOrigin, { color: theme.textSecondary }]}
                >
                  {props.cuisineOrigin}
                </ThemedText>
              )}
              {props.chefTips?.map((tip, i) => (
                <ThemedText key={i} style={styles.chefTip}>
                  {"•"} {tip}
                </ThemedText>
              ))}
            </View>
          )}

        {/* 9c. Community stats (public community recipes only — the
            component renders nothing unless the stats request succeeds,
            and the server 404s non-public recipes) */}
        {isCommunityRecipe && props.recipeId > 0 && (
          <RecipeCommunityStats
            recipeId={props.recipeId}
            recipeTitle={props.title}
            onRemix={handleRemixPress}
          />
        )}

        {/* 10. Ask Coach */}
        <AskCoachSection
          questions={recipeCoachQuestions}
          screenContext={recipeCoachContext}
          onCustomPress={(q) => {
            if (q.question === "__remix__") {
              handleRemixPress();
              return true;
            }
            return false;
          }}
        />
      </ScrollView>

      <CookbookPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        recipeId={props.recipeId}
        recipeType={props.recipeType}
      />
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  heroImage: {
    width: "100%",
    height: HERO_IMAGE_HEIGHT,
  },
  // Tools Required (curated)
  toolsSection: {
    marginTop: Spacing.lg,
  },
  toolsSectionTitle: {
    marginBottom: Spacing.sm,
  },
  toolRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  toolName: {
    fontSize: 15,
  },
  // Chef's Notes (curated)
  chefCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: 12,
  },
  chefCardTitle: {
    marginBottom: Spacing.sm,
  },
  cuisineOrigin: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 6,
    fontStyle: "italic",
  },
  chefTip: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.sm,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  saveButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  lineageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: Spacing.sm,
  },
  lineageText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
});
