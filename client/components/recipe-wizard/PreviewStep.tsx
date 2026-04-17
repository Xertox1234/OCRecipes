import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { useRecipeForm } from "@/hooks/useRecipeForm";
import type { WizardStep } from "./types";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface PreviewStepProps {
  form: ReturnType<typeof useRecipeForm>;
  onEditStep: (step: WizardStep) => void;
}

// ── Helper components ────────────────────────────────────────────────────────

interface EditButtonProps {
  onPress: () => void;
  color: string;
}

function EditButton({ onPress, color }: EditButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Edit"
    >
      <Text style={[styles.editButtonText, { color }]}>Edit ✎</Text>
    </Pressable>
  );
}

interface PreviewSectionProps {
  label: string;
  onEdit: () => void;
  editColor: string;
  labelColor: string;
  children: React.ReactNode;
}

function PreviewSection({
  label,
  onEdit,
  editColor,
  labelColor,
  children,
}: PreviewSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionHeaderText, { color: labelColor }]}>
          {label}
        </Text>
        <EditButton onPress={onEdit} color={editColor} />
      </View>
      {children}
    </View>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PreviewStep({ form, onEditStep }: PreviewStepProps) {
  const { theme } = useTheme();

  const {
    title,
    description,
    ingredients,
    steps,
    timeServings,
    nutrition,
    tags,
  } = form;

  // Derived values
  const filledIngredients = ingredients.filter((i) => i.text.trim());
  const filledSteps = steps.filter((s) => s.text.trim());

  const totalTime =
    (parseInt(timeServings.prepTime, 10) || 0) +
    (parseInt(timeServings.cookTime, 10) || 0);

  const hasNutrition =
    nutrition.calories || nutrition.protein || nutrition.carbs || nutrition.fat;

  const ingredientSummary =
    filledIngredients.length > 0
      ? filledIngredients.map((i) => `• ${i.text.trim()}`).join("  ")
      : "None added";

  const instructionSummary =
    filledSteps.length > 0
      ? filledSteps.map((s, idx) => `${idx + 1}. ${s.text.trim()}`).join("  ")
      : "None added";

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Card wrapper */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: withOpacity(theme.border, 0.5),
          },
        ]}
      >
        {/* 1. Image placeholder */}
        <View
          style={[
            styles.imagePlaceholder,
            { backgroundColor: withOpacity(theme.link, 0.08) },
          ]}
        >
          <Feather name="image" size={32} color={theme.link} />
          <Text
            style={[
              styles.imagePlaceholderText,
              { color: theme.textSecondary },
            ]}
          >
            Image will be generated after save
          </Text>
        </View>

        {/* 2. Title section */}
        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: theme.text, flex: 1 }]}
              numberOfLines={2}
            >
              {title.trim() || "Untitled Recipe"}
            </Text>
            <EditButton onPress={() => onEditStep(1)} color={theme.link} />
          </View>
          {description.trim().length > 0 && (
            <Text
              style={[styles.description, { color: theme.textSecondary }]}
              numberOfLines={3}
            >
              {description.trim()}
            </Text>
          )}

          {/* Divider */}
          <View
            style={[
              styles.divider,
              { backgroundColor: withOpacity(theme.border, 0.4) },
            ]}
          />

          {/* 3. Meta row */}
          <PreviewSection
            label="Time & Servings"
            onEdit={() => onEditStep(4)}
            editColor={theme.link}
            labelColor={theme.text}
          >
            <View style={styles.metaRow}>
              {totalTime > 0 && (
                <View style={styles.metaChip}>
                  <Feather name="clock" size={13} color={theme.textSecondary} />
                  <Text style={[styles.metaText, { color: theme.text }]}>
                    {totalTime} min
                  </Text>
                </View>
              )}
              <View style={styles.metaChip}>
                <Feather name="users" size={13} color={theme.textSecondary} />
                <Text style={[styles.metaText, { color: theme.text }]}>
                  {timeServings.servings} serving
                  {timeServings.servings !== 1 ? "s" : ""}
                </Text>
              </View>
              {tags.cuisine.trim().length > 0 && (
                <View style={styles.metaChip}>
                  <Feather name="globe" size={13} color={theme.textSecondary} />
                  <Text style={[styles.metaText, { color: theme.text }]}>
                    {tags.cuisine.trim()}
                  </Text>
                </View>
              )}
            </View>
          </PreviewSection>

          {/* Divider */}
          <View
            style={[
              styles.divider,
              { backgroundColor: withOpacity(theme.border, 0.4) },
            ]}
          />

          {/* 4. Ingredients section */}
          <PreviewSection
            label={`Ingredients (${filledIngredients.length})`}
            onEdit={() => onEditStep(2)}
            editColor={theme.link}
            labelColor={theme.text}
          >
            <Text
              style={[styles.summaryText, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {ingredientSummary}
            </Text>
          </PreviewSection>

          {/* Divider */}
          <View
            style={[
              styles.divider,
              { backgroundColor: withOpacity(theme.border, 0.4) },
            ]}
          />

          {/* 5. Instructions section */}
          <PreviewSection
            label={`Instructions (${filledSteps.length} step${filledSteps.length !== 1 ? "s" : ""})`}
            onEdit={() => onEditStep(3)}
            editColor={theme.link}
            labelColor={theme.text}
          >
            <Text
              style={[styles.summaryText, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {instructionSummary}
            </Text>
          </PreviewSection>

          {/* Divider */}
          <View
            style={[
              styles.divider,
              { backgroundColor: withOpacity(theme.border, 0.4) },
            ]}
          />

          {/* 6. Nutrition section */}
          <PreviewSection
            label="Nutrition"
            onEdit={() => onEditStep(5)}
            editColor={theme.link}
            labelColor={theme.text}
          >
            {hasNutrition ? (
              <View style={styles.nutritionRow}>
                {nutrition.calories ? (
                  <View style={styles.macroItem}>
                    <Text
                      style={[
                        styles.macroValue,
                        { color: theme.calorieAccent },
                      ]}
                    >
                      {nutrition.calories}
                    </Text>
                    <Text
                      style={[
                        styles.macroLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      cal
                    </Text>
                  </View>
                ) : null}
                {nutrition.protein ? (
                  <View style={styles.macroItem}>
                    <Text
                      style={[
                        styles.macroValue,
                        { color: theme.proteinAccent },
                      ]}
                    >
                      {nutrition.protein}g
                    </Text>
                    <Text
                      style={[
                        styles.macroLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      protein
                    </Text>
                  </View>
                ) : null}
                {nutrition.carbs ? (
                  <View style={styles.macroItem}>
                    <Text
                      style={[styles.macroValue, { color: theme.carbsAccent }]}
                    >
                      {nutrition.carbs}g
                    </Text>
                    <Text
                      style={[
                        styles.macroLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      carbs
                    </Text>
                  </View>
                ) : null}
                {nutrition.fat ? (
                  <View style={styles.macroItem}>
                    <Text
                      style={[styles.macroValue, { color: theme.fatAccent }]}
                    >
                      {nutrition.fat}g
                    </Text>
                    <Text
                      style={[
                        styles.macroLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      fat
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text
                style={[styles.summaryText, { color: theme.textSecondary }]}
              >
                Not specified
              </Text>
            )}
          </PreviewSection>

          {/* Divider */}
          <View
            style={[
              styles.divider,
              { backgroundColor: withOpacity(theme.border, 0.4) },
            ]}
          />

          {/* 7. Tags section */}
          <PreviewSection
            label="Tags"
            onEdit={() => onEditStep(6)}
            editColor={theme.link}
            labelColor={theme.text}
          >
            {tags.dietTags.length > 0 ? (
              <View style={styles.chipsRow}>
                {tags.dietTags.map((tag) => (
                  <View
                    key={tag}
                    style={[
                      styles.tagChip,
                      { backgroundColor: withOpacity(theme.link, 0.15) },
                    ]}
                  >
                    <Text style={[styles.tagChipText, { color: theme.link }]}>
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text
                style={[styles.summaryText, { color: theme.textSecondary }]}
              >
                None
              </Text>
            )}
          </PreviewSection>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing.xl,
  },
  card: {
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    overflow: "hidden",
  },
  imagePlaceholder: {
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  imagePlaceholderText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
  },
  cardBody: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 20,
    lineHeight: 28,
  },
  description: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.xs,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeaderText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    // color applied dynamically
  },
  editButtonText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
  },
  summaryText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  nutritionRow: {
    flexDirection: "row",
    gap: Spacing.lg,
  },
  macroItem: {
    alignItems: "center",
  },
  macroValue: {
    fontFamily: FontFamily.semiBold,
    fontSize: 16,
  },
  macroLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  tagChipText: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
  },
});
