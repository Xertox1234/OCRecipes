import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
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
import { usePremiumContext } from "@/context/PremiumContext";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  withOpacity,
} from "@/constants/theme";

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
}

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function RecipeDetailContent(props: RecipeDetailContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<NavProp>();
  const { isPremium } = usePremiumContext();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const isCommunityRecipe = props.recipeType === "community";

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
  const { data: allergenResult } = useAllergenCheck(ingredientNames);

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
        {/* 1. Hero Image */}
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
          />

          {/* 4. Save to Cookbook */}
          {props.recipeId > 0 && (
            <Pressable
              onPress={() => {
                haptics.impact();
                setPickerVisible(true);
              }}
              style={[
                styles.saveButton,
                { backgroundColor: withOpacity(theme.link, 0.1) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save to cookbook"
            >
              <Feather name="bookmark" size={14} color={theme.link} />
              <ThemedText
                style={[styles.saveButtonText, { color: theme.link }]}
              >
                Save to Cookbook
              </ThemedText>
            </Pressable>
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
          {props.ingredients && props.ingredients.length > 0 && (
            <RecipeIngredientsList
              ingredients={props.ingredients}
              allergenResult={allergenResult}
            />
          )}
        </View>

        {/* 8. Food Facts (outside content padding — components handle own padding) */}
        <FoodFacts ingredientNames={ingredientNames} />

        {/* 9. Structured Instructions */}
        <RecipeInstructions instructions={props.instructions ?? []} />

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
