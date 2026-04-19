import React, { useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { useRecipeForm, NutritionData } from "@/hooks/useRecipeForm";
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

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Returns true if any macro field has content. */
export function hasNutrition(nutrition: NutritionData): boolean {
  return Boolean(
    nutrition.calories || nutrition.protein || nutrition.carbs || nutrition.fat,
  );
}

// ── Helper components ────────────────────────────────────────────────────────

interface EditButtonProps {
  onPress: () => void;
  color: string;
  label: string;
}

function EditButton({ onPress, color, label }: EditButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.editButton}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${label}`}
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
        <EditButton onPress={onEdit} color={editColor} label={label} />
      </View>
      {children}
    </View>
  );
}

interface MacroItemProps {
  value: string;
  label: string;
  valueColor: string;
  labelColor: string;
  unit?: string;
}

/** Single macro cell inside the nutrition row. Exported for testing. */
export function MacroItem({
  value,
  label,
  valueColor,
  labelColor,
  unit = "",
}: MacroItemProps) {
  return (
    <View style={styles.macroItem}>
      <Text style={[styles.macroValue, { color: valueColor }]}>
        {value}
        {unit}
      </Text>
      <Text style={[styles.macroLabel, { color: labelColor }]}>{label}</Text>
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

  // Derived values — memoized so they only recompute when their source
  // arrays change. Ingredient/instruction arrays change on every keystroke
  // inside another step, but the Preview step is only mounted at step 7, so
  // the real win is avoiding the .filter + .map work on unrelated re-renders
  // (theme flip, safe-area change, parent state).
  const filledIngredients = useMemo(
    () => ingredients.filter((i) => i.text.trim()),
    [ingredients],
  );
  const filledSteps = useMemo(
    () => steps.filter((s) => s.text.trim()),
    [steps],
  );

  const totalTime =
    (parseInt(timeServings.prepTime, 10) || 0) +
    (parseInt(timeServings.cookTime, 10) || 0);

  const nutritionFilled = hasNutrition(nutrition);

  const ingredientSummary = useMemo(
    () =>
      filledIngredients.length > 0
        ? filledIngredients.map((i) => `• ${i.text.trim()}`).join("  ")
        : "None added",
    [filledIngredients],
  );

  const instructionSummary = useMemo(
    () =>
      filledSteps.length > 0
        ? filledSteps.map((s, idx) => `${idx + 1}. ${s.text.trim()}`).join("  ")
        : "None added",
    [filledSteps],
  );

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
            <EditButton
              onPress={() => onEditStep(1)}
              color={theme.link}
              label="Title"
            />
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
            {nutritionFilled ? (
              <View style={styles.nutritionRow}>
                {nutrition.calories ? (
                  <MacroItem
                    value={nutrition.calories}
                    label="cal"
                    valueColor={theme.calorieAccent}
                    labelColor={theme.textSecondary}
                  />
                ) : null}
                {nutrition.protein ? (
                  <MacroItem
                    value={nutrition.protein}
                    unit="g"
                    label="protein"
                    valueColor={theme.proteinAccent}
                    labelColor={theme.textSecondary}
                  />
                ) : null}
                {nutrition.carbs ? (
                  <MacroItem
                    value={nutrition.carbs}
                    unit="g"
                    label="carbs"
                    valueColor={theme.carbsAccent}
                    labelColor={theme.textSecondary}
                  />
                ) : null}
                {nutrition.fat ? (
                  <MacroItem
                    value={nutrition.fat}
                    unit="g"
                    label="fat"
                    valueColor={theme.fatAccent}
                    labelColor={theme.textSecondary}
                  />
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
  editButton: {
    // WCAG 2.5.5 — 44×44 minimum tap target. The text is small (13px) but
    // the pressable region is padded to 44×44 so the button is easily tapped.
    minWidth: 44,
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
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
