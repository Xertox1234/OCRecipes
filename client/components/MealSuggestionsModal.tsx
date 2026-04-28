import React, { useCallback, useEffect, useMemo } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useMealSuggestions } from "@/hooks/useMealSuggestions";
import { ApiError } from "@/lib/api-error";
import type {
  MealSuggestion,
  PopularPick,
} from "@shared/types/meal-suggestions";

interface MealSuggestionsModalProps {
  visible: boolean;
  date: string;
  mealType: string;
  onClose: () => void;
  onSelectSuggestion: (suggestion: MealSuggestion) => void;
}

function SuggestionSkeleton() {
  return (
    <View style={styles.skeletonCard}>
      <SkeletonBox width="70%" height={18} borderRadius={4} />
      <View style={{ height: Spacing.sm }} />
      <SkeletonBox width="100%" height={14} borderRadius={4} />
      <View style={{ height: Spacing.xs }} />
      <SkeletonBox width="60%" height={14} borderRadius={4} />
      <View style={{ height: Spacing.md }} />
      <SkeletonBox width="40%" height={32} borderRadius={16} />
    </View>
  );
}

const SuggestionCard = React.memo(function SuggestionCard({
  suggestion,
  onSelect,
}: {
  suggestion: MealSuggestion;
  onSelect: (s: MealSuggestion) => void;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handlePick = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(suggestion);
  }, [haptics, onSelect, suggestion]);

  return (
    <View
      style={[
        styles.suggestionCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      <ThemedText style={styles.suggestionTitle}>{suggestion.title}</ThemedText>
      <ThemedText
        style={[styles.suggestionDescription, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {suggestion.description}
      </ThemedText>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Feather name="zap" size={12} color={theme.calorieAccent} />
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {suggestion.calories} cal
          </ThemedText>
        </View>
        <View style={styles.metaItem}>
          <Feather name="clock" size={12} color={theme.textSecondary} />
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {suggestion.prepTimeMinutes} min
          </ThemedText>
        </View>
        <View style={styles.metaItem}>
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {suggestion.difficulty}
          </ThemedText>
        </View>
      </View>

      <ThemedText
        style={[styles.reasoning, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {suggestion.reasoning}
      </ThemedText>

      <Pressable
        onPress={handlePick}
        style={({ pressed }) => [
          styles.pickButton,
          {
            backgroundColor: theme.link,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Pick ${suggestion.title}`}
      >
        <ThemedText
          style={[styles.pickButtonText, { color: theme.buttonText }]}
        >
          Pick
        </ThemedText>
      </Pressable>
    </View>
  );
});

const PopularPickCard = React.memo(function PopularPickCard({
  pick,
  onSelect,
}: {
  pick: PopularPick;
  onSelect: (s: MealSuggestion) => void;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handlePick = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    // Convert PopularPick to MealSuggestion shape for the existing onSelectSuggestion flow
    onSelect({
      title: pick.title,
      description: pick.description || "",
      reasoning: "",
      calories: Number(pick.calories) || 0,
      protein: Number(pick.protein) || 0,
      carbs: Number(pick.carbs) || 0,
      fat: Number(pick.fat) || 0,
      prepTimeMinutes: pick.prepTimeMinutes || 0,
      difficulty:
        pick.difficulty === "Easy" ||
        pick.difficulty === "Medium" ||
        pick.difficulty === "Hard"
          ? pick.difficulty
          : "Easy",
      ingredients: [],
      instructions: [],
      dietTags: pick.dietTags,
    });
  }, [haptics, onSelect, pick]);

  return (
    <View
      style={[
        styles.suggestionCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      <View style={styles.popularPickHeader}>
        <ThemedText style={[styles.suggestionTitle, { flex: 1 }]}>
          {pick.title}
        </ThemedText>
        <View
          style={[
            styles.pickCountBadge,
            { backgroundColor: withOpacity(theme.link, 0.12) },
          ]}
        >
          <Feather name="users" size={10} color={theme.link} />
          <ThemedText style={[styles.pickCountText, { color: theme.link }]}>
            {pick.pickCount}
          </ThemedText>
        </View>
      </View>
      {pick.description ? (
        <ThemedText
          style={[styles.suggestionDescription, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {pick.description}
        </ThemedText>
      ) : null}

      <View style={styles.metaRow}>
        {pick.calories ? (
          <View style={styles.metaItem}>
            <Feather name="zap" size={12} color={theme.calorieAccent} />
            <ThemedText
              style={[styles.metaText, { color: theme.textSecondary }]}
            >
              {pick.calories} cal
            </ThemedText>
          </View>
        ) : null}
        {pick.prepTimeMinutes ? (
          <View style={styles.metaItem}>
            <Feather name="clock" size={12} color={theme.textSecondary} />
            <ThemedText
              style={[styles.metaText, { color: theme.textSecondary }]}
            >
              {pick.prepTimeMinutes} min
            </ThemedText>
          </View>
        ) : null}
        {pick.difficulty ? (
          <View style={styles.metaItem}>
            <ThemedText
              style={[styles.metaText, { color: theme.textSecondary }]}
            >
              {pick.difficulty}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={handlePick}
        style={({ pressed }) => [
          styles.pickButton,
          {
            backgroundColor: theme.link,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Pick ${pick.title}`}
      >
        <ThemedText
          style={[styles.pickButtonText, { color: theme.buttonText }]}
        >
          Pick
        </ThemedText>
      </Pressable>
    </View>
  );
});

export function MealSuggestionsModal({
  visible,
  date,
  mealType,
  onClose,
  onSelectSuggestion,
}: MealSuggestionsModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const mutation = useMealSuggestions();

  // Auto-fetch on open
  useEffect(() => {
    if (visible && !mutation.isPending && !mutation.data) {
      mutation.mutate({ date, mealType });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation excluded to prevent infinite re-renders (changes identity on mutate)
  }, [visible, date, mealType]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (mutation.isError) {
      const isLimit =
        mutation.error instanceof ApiError &&
        mutation.error.code === "DAILY_LIMIT_REACHED";
      AccessibilityInfo.announceForAccessibility(
        isLimit ? "Daily suggestion limit reached" : mutation.error.message,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce only on error state change
  }, [mutation.isError]);

  const handleSuggestMore = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    mutation.mutate({ date, mealType });
  }, [haptics, mutation, date, mealType]);

  const handleClose = useCallback(() => {
    mutation.reset();
    onClose();
  }, [mutation, onClose]);

  const isLimitReached =
    mutation.error instanceof ApiError &&
    mutation.error.code === "DAILY_LIMIT_REACHED";

  const mealLabel = useMemo(
    () => mealType.charAt(0).toUpperCase() + mealType.slice(1),
    [mealType],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
        <View
          accessibilityViewIsModal
          style={[
            styles.container,
            {
              backgroundColor: theme.backgroundDefault,
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <ThemedText style={styles.headerTitle}>
              {mealLabel} Suggestions
            </ThemedText>
            <Pressable
              onPress={handleClose}
              accessibilityLabel="Close suggestions"
              accessibilityRole="button"
              hitSlop={12}
            >
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Loading */}
            {mutation.isPending && (
              <SkeletonProvider>
                <SuggestionSkeleton />
                <SuggestionSkeleton />
                <SuggestionSkeleton />
              </SkeletonProvider>
            )}

            {/* Error */}
            {mutation.isError && !isLimitReached && (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.errorContainer}
              >
                <Feather
                  name="alert-circle"
                  size={32}
                  color={theme.error}
                  accessible={false}
                />
                <ThemedText style={[styles.errorText, { color: theme.error }]}>
                  {mutation.error.message}
                </ThemedText>
                <Pressable
                  onPress={handleSuggestMore}
                  style={[styles.retryButton, { borderColor: theme.link }]}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                >
                  <ThemedText style={{ color: theme.link }}>
                    Try Again
                  </ThemedText>
                </Pressable>
              </View>
            )}

            {/* Limit reached */}
            {isLimitReached && (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.errorContainer}
              >
                <Feather
                  name="clock"
                  size={32}
                  color={theme.textSecondary}
                  accessible={false}
                />
                <ThemedText
                  style={[styles.errorText, { color: theme.textSecondary }]}
                >
                  Daily suggestion limit reached. Try again tomorrow.
                </ThemedText>
              </View>
            )}

            {/* Suggestions */}
            {mutation.data?.suggestions.map((suggestion, index) => (
              <SuggestionCard
                key={`${suggestion.title}-${index}`}
                suggestion={suggestion}
                onSelect={onSelectSuggestion}
              />
            ))}

            {/* Popular Picks */}
            {(mutation.data?.popularPicks?.length ?? 0) > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Feather
                    name="trending-up"
                    size={14}
                    color={theme.textSecondary}
                  />
                  <ThemedText
                    style={[
                      styles.sectionHeaderText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Popular Picks
                  </ThemedText>
                </View>
                {mutation.data!.popularPicks.map((pick, index) => (
                  <PopularPickCard
                    key={`popular-${pick.title}-${index}`}
                    pick={pick}
                    onSelect={onSelectSuggestion}
                  />
                ))}
              </>
            )}

            {/* Suggest More */}
            {mutation.data && !isLimitReached && (
              <View style={styles.footer}>
                <ThemedText
                  style={[styles.remainingText, { color: theme.textSecondary }]}
                >
                  {mutation.data.remainingToday} suggestions remaining today
                </ThemedText>
                <Pressable
                  onPress={handleSuggestMore}
                  disabled={
                    mutation.isPending || mutation.data.remainingToday <= 0
                  }
                  style={({ pressed }) => [
                    styles.suggestMoreButton,
                    {
                      borderColor: theme.link,
                      opacity:
                        mutation.data!.remainingToday <= 0
                          ? 0.4
                          : pressed
                            ? 0.7
                            : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Suggest more meals"
                >
                  {mutation.isPending ? (
                    <ActivityIndicator color={theme.link} size="small" />
                  ) : (
                    <ThemedText style={{ color: theme.link }}>
                      Suggest More
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
  },
  scrollContent: {
    paddingBottom: Spacing.md,
  },
  skeletonCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  suggestionCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.md,
  },
  suggestionTitle: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.xs,
  },
  suggestionDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  reasoning: {
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  pickButton: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  pickButtonText: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
  },
  errorContainer: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    gap: Spacing.md,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  footer: {
    alignItems: "center",
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  remainingText: {
    fontSize: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
  },
  popularPickHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  pickCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  pickCountText: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
  suggestMoreButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minWidth: 120,
    alignItems: "center",
  },
});
