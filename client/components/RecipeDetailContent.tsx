import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { CookbookPickerModal } from "@/components/CookbookPickerModal";
import {
  NutritionCard,
  RecipeMetaChips,
  RecipeIngredientsList,
  RecipeDietTags,
} from "@/components/recipe-detail";
import type { NutritionData, IngredientItem } from "@/components/recipe-detail";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAllergenCheck } from "@/hooks/useAllergenCheck";
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
  instructions?: string | null;
  contentPaddingTop?: number;
  contentPaddingBottom?: number;
}

export function RecipeDetailContent(props: RecipeDetailContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [pickerVisible, setPickerVisible] = useState(false);

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

          {/* 8. Instructions */}
          {props.instructions && (
            <View style={styles.instructionsSection}>
              <ThemedText style={styles.sectionTitle}>Instructions</ThemedText>
              <ThemedText
                style={[styles.instructions, { color: theme.textSecondary }]}
              >
                {props.instructions}
              </ThemedText>
            </View>
          )}
        </View>
      </ScrollView>

      <CookbookPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        recipeId={props.recipeId}
        recipeType={props.recipeType}
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
  sectionTitle: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  instructionsSection: {
    marginBottom: Spacing.xl,
  },
  instructions: {
    fontSize: 15,
    lineHeight: 24,
  },
});
