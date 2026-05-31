import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
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
import type { NutritionData, IngredientItem } from "@/components/recipe-detail";
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

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function RecipeDetailContent(props: RecipeDetailContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<NavProp>();
  const { isPremium } = usePremiumContext();
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

  useEffect(() => {
    setExpandedStep(null);
  }, [props.recipeId]);

  const hasShownHintRef = useRef(hasShownHint);
  useEffect(() => {
    hasShownHintRef.current = hasShownHint;
  }, [hasShownHint]);

  const handleStepLongPress = useCallback((index: number) => {
    setExpandedStep((prev) => (prev === index ? null : index));
    if (!hasShownHintRef.current) {
      setHasShownHint(true);
      void AsyncStorage.setItem(CURATED_STEP_HINT_KEY, "1");
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
    if (!isPremium) {
      setShowUpgrade(true);
      return;
    }
    haptics.impact();
    navigation.navigate("RecipeChat", {
      remixSourceRecipeId: props.recipeId,
      remixSourceRecipeTitle: props.title,
    });
  }, [isPremium, haptics, navigation, props.recipeId, props.title]);

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
    () => [...new Set(props.dietTags ?? [])],
    [props.dietTags],
  );

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
                resizeMode="cover"
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
            accessibilityLabel={`Photo of ${props.title}`}
          />
        )}

        <View style={styles.content}>
          {/* 2. Title + Description */}
          <ThemedText type="h3" style={styles.title}>
            {props.title}
          </ThemedText>

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
          {uniqueTags.length > 0 && <RecipeDietTags tags={uniqueTags} />}

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

        {/* 9. Structured Instructions */}
        {props.isCanonical && (props.instructions ?? []).length > 0 ? (
          <View
            style={styles.instructionsSection}
            accessibilityRole="list"
            accessibilityLabel={`Instructions, ${(props.instructions ?? []).length} steps`}
          >
            <ThemedText
              type="h4"
              style={styles.instructionsSectionTitle}
              accessibilityRole="header"
            >
              Instructions
            </ThemedText>
            {(props.instructions ?? []).map((step, i) => {
              const detail = props.instructionDetails?.[i];
              const isExpandable = !!detail;
              const isExpanded = expandedStep === i;
              return (
                <Pressable
                  key={i}
                  onPress={
                    isExpandable ? () => handleStepLongPress(i) : undefined
                  }
                  onLongPress={
                    isExpandable ? () => handleStepLongPress(i) : undefined
                  }
                  delayLongPress={300}
                  style={[
                    styles.stepCard,
                    { backgroundColor: withOpacity(theme.text, 0.04) },
                  ]}
                  accessible
                  accessibilityLabel={`Step ${i + 1} of ${(props.instructions ?? []).length}: ${step}${isExpandable ? ". Tap for more detail." : ""}`}
                >
                  <View
                    style={[styles.stepCircle, { backgroundColor: theme.link }]}
                    accessible={false}
                  >
                    <ThemedText style={styles.stepNumber}>{i + 1}</ThemedText>
                  </View>
                  <View style={styles.stepBody}>
                    <ThemedText style={styles.stepText}>{step}</ThemedText>
                    {isExpanded && detail && (
                      <ThemedText style={styles.stepDetail}>
                        {detail}
                      </ThemedText>
                    )}
                  </View>
                </Pressable>
              );
            })}
            {!hasShownHint && (
              <ThemedText
                style={[styles.stepHint, { color: theme.textSecondary }]}
              >
                Hold any step for more detail
              </ThemedText>
            )}

            {/* Tools Required */}
            {(props.toolsRequired?.length ?? 0) > 0 && (
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
                            WebBrowser.openBrowserAsync(
                              tool.affiliateUrl!,
                            ).catch(() => {
                              toast.error(
                                "Couldn't open link. Please try again.",
                              );
                            });
                          }
                        : undefined
                    }
                    style={styles.toolRow}
                    accessibilityRole={tool.affiliateUrl ? "link" : "text"}
                    accessibilityLabel={
                      tool.affiliateUrl
                        ? `${tool.name}, tap to view`
                        : tool.name
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
          </View>
        ) : (
          <RecipeInstructions instructions={props.instructions ?? []} />
        )}

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
  // Expandable instructions (curated)
  instructionsSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  instructionsSectionTitle: {
    marginBottom: Spacing.md,
  },
  stepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  stepNumber: {
    color: "#FFFFFF", // hardcoded: white on themed link-color circle
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  stepBody: {
    flex: 1,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 4,
  },
  stepDetail: {
    marginTop: 6,
    opacity: 0.75,
    fontSize: 13,
    lineHeight: 18,
  },
  stepHint: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 4,
    fontStyle: "italic",
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
