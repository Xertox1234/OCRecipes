import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
  LayoutChangeEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { SaveButton } from "@/components/SaveButton";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { useSuggestionInstructions } from "@/hooks/useSuggestionInstructions";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
  contentRevealTimingConfig,
} from "@/constants/animations";
import type { CreateSavedItemInput } from "@shared/schemas/saved-items";

type Theme = (typeof Colors)["light"] | (typeof Colors)["dark"];

export interface Suggestion {
  type: "recipe" | "craft" | "pairing";
  title: string;
  description: string;
  difficulty?: string;
  timeEstimate?: string;
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  itemId: number;
  suggestionIndex: number;
  productName: string;
}

type CardState = "collapsed" | "loading" | "expanded";

interface ExpandedContentProps {
  isLoading: boolean;
  instructionsData: { instructions: string } | undefined;
  iconColor: string;
  theme: Theme;
  savedItem: CreateSavedItemInput;
  onContentLayout?: (event: LayoutChangeEvent) => void;
}

function ExpandedContent({
  isLoading,
  instructionsData,
  iconColor,
  theme,
  savedItem,
  onContentLayout,
}: ExpandedContentProps) {
  if (isLoading) {
    return (
      <View
        style={styles.loadingContainer}
        accessible={true}
        accessibilityLabel="Loading instructions"
        accessibilityRole="progressbar"
      >
        <ActivityIndicator size="small" color={iconColor} />
        <ThemedText
          type="caption"
          style={{
            color: theme.textSecondary,
            marginTop: Spacing.sm,
          }}
        >
          Loading instructions...
        </ThemedText>
      </View>
    );
  }

  if (instructionsData) {
    return (
      <View onLayout={onContentLayout}>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <ThemedText
          type="caption"
          style={[styles.instructionsLabel, { color: iconColor }]}
        >
          INSTRUCTIONS
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.instructions, { color: theme.text }]}
        >
          {instructionsData.instructions}
        </ThemedText>
        <View style={styles.saveButtonRow}>
          <SaveButton item={savedItem} />
          <ThemedText
            type="caption"
            style={{
              color: theme.textSecondary,
              marginLeft: Spacing.sm,
            }}
          >
            Save to library
          </ThemedText>
        </View>
      </View>
    );
  }

  return null;
}

export function SuggestionCard({
  suggestion,
  itemId,
  suggestionIndex,
  productName,
}: SuggestionCardProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();
  const [cardState, setCardState] = useState<CardState>("collapsed");
  const [contentHeight, setContentHeight] = useState(0);

  // Animated height for expansion
  const animatedHeight = useSharedValue(0);

  // Fetch instructions when expanded
  const { data: instructionsData, error: instructionsError } =
    useSuggestionInstructions({
      itemId,
      suggestionIndex,
      suggestionTitle: suggestion.title,
      suggestionType: suggestion.type,
      enabled: cardState === "loading" || cardState === "expanded",
    });

  // Update state when instructions arrive
  React.useEffect(() => {
    if (cardState === "loading" && instructionsData) {
      setCardState("expanded");
    }
  }, [cardState, instructionsData]);

  // Update state on error
  React.useEffect(() => {
    if (cardState === "loading" && instructionsError) {
      setCardState("collapsed");
    }
  }, [cardState, instructionsError]);

  const iconName =
    suggestion.type === "recipe"
      ? "book-open"
      : suggestion.type === "craft"
        ? "scissors"
        : "coffee";

  const iconColor =
    suggestion.type === "recipe"
      ? theme.success
      : suggestion.type === "craft"
        ? theme.proteinAccent
        : theme.fatAccent;

  const typeLabel =
    suggestion.type === "craft" ? "Kid Activity" : suggestion.type;

  // Map suggestion type to saved item type
  const savedItemType = suggestion.type === "craft" ? "activity" : "recipe";

  const handlePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    if (cardState === "collapsed") {
      setCardState("loading");
      // Animate to approximate height while loading
      if (!reducedMotion) {
        animatedHeight.value = withTiming(200, expandTimingConfig);
      }
    } else if (cardState === "expanded") {
      setCardState("collapsed");
      if (!reducedMotion) {
        animatedHeight.value = withTiming(0, collapseTimingConfig);
      }
    }
    // Don't allow toggle while loading
  }, [cardState, haptics, reducedMotion, animatedHeight]);

  const handleContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout;
      if (height > 0 && height !== contentHeight) {
        setContentHeight(height);
        if (cardState === "expanded" && !reducedMotion) {
          animatedHeight.value = withTiming(height, contentRevealTimingConfig);
        }
      }
    },
    [cardState, contentHeight, reducedMotion, animatedHeight],
  );

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      height: animatedHeight.value,
      overflow: "hidden",
    };
  });

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(suggestionIndex * 100).duration(300);

  // Prepare saved item data
  const savedItem: CreateSavedItemInput = {
    type: savedItemType,
    title: suggestion.title,
    description: suggestion.description,
    difficulty: suggestion.difficulty,
    timeEstimate: suggestion.timeEstimate,
    instructions: instructionsData?.instructions,
    sourceItemId: itemId,
    sourceProductName: productName,
  };

  const isExpanded = cardState === "expanded";
  const isLoading = cardState === "loading";

  return (
    <Animated.View
      entering={enteringAnimation}
      accessible={true}
      accessibilityLabel={`${typeLabel}: ${suggestion.title}. ${suggestion.description}. ${isExpanded ? "Expanded. Tap to collapse." : "Tap to expand and see full instructions."}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
    >
      <Card
        elevation={1}
        style={[styles.suggestionCard, { borderLeftColor: iconColor }]}
      >
        <Pressable
          onPress={handlePress}
          accessibilityLabel={`${isExpanded ? "Collapse" : "Expand"} ${suggestion.title}`}
          accessibilityRole="button"
          accessibilityHint={
            isExpanded
              ? "Collapses to hide instructions"
              : "Expands to show full instructions"
          }
        >
          <View style={styles.suggestionHeader}>
            <View
              style={[
                styles.suggestionIcon,
                { backgroundColor: `${iconColor}15` },
              ]}
            >
              <Feather name={iconName} size={24} color={iconColor} />
            </View>
            <View style={styles.suggestionMeta}>
              <View style={styles.metaLeft}>
                <ThemedText
                  type="caption"
                  style={{
                    color: iconColor,
                    textTransform: "uppercase",
                    fontWeight: "600",
                    letterSpacing: 0.5,
                  }}
                >
                  {suggestion.type === "craft"
                    ? "Kid Activity"
                    : suggestion.type}
                </ThemedText>
                {suggestion.timeEstimate ? (
                  <View style={styles.timeBadge}>
                    <Feather
                      name="clock"
                      size={12}
                      color={theme.textSecondary}
                    />
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      {suggestion.timeEstimate}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <View style={styles.chevronContainer}>
                <Feather
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={theme.textSecondary}
                />
              </View>
            </View>
          </View>
          <ThemedText type="h4" style={styles.suggestionTitle}>
            {suggestion.title}
          </ThemedText>
          <ThemedText
            type="body"
            style={[
              styles.suggestionDescription,
              { color: theme.textSecondary },
            ]}
          >
            {suggestion.description}
          </ThemedText>
          {suggestion.difficulty ? (
            <View style={styles.suggestionFooter}>
              <View
                style={[
                  styles.difficultyBadge,
                  { backgroundColor: `${iconColor}15` },
                ]}
              >
                <ThemedText type="caption" style={{ color: iconColor }}>
                  {suggestion.difficulty}
                </ThemedText>
              </View>
            </View>
          ) : null}
        </Pressable>

        {/* Expandable content */}
        {reducedMotion ? (
          // No animation for reduced motion
          (isLoading || isExpanded) && (
            <View style={styles.expandedContent}>
              <ExpandedContent
                isLoading={isLoading}
                instructionsData={instructionsData}
                iconColor={iconColor}
                theme={theme}
                savedItem={savedItem}
                onContentLayout={handleContentLayout}
              />
            </View>
          )
        ) : (
          // Animated expansion
          <Animated.View style={animatedContainerStyle}>
            <View style={styles.expandedContent}>
              <ExpandedContent
                isLoading={isLoading}
                instructionsData={instructionsData}
                iconColor={iconColor}
                theme={theme}
                savedItem={savedItem}
                onContentLayout={handleContentLayout}
              />
            </View>
          </Animated.View>
        )}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  suggestionCard: {
    padding: Spacing.lg,
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  suggestionIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  suggestionMeta: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  metaLeft: {
    flex: 1,
  },
  chevronContainer: {
    padding: Spacing.xs,
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  suggestionTitle: {
    fontWeight: "700",
    marginBottom: Spacing.sm,
  },
  suggestionDescription: {
    lineHeight: 22,
  },
  suggestionFooter: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
  },
  difficultyBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  expandedContent: {
    // Container for content, no specific styles needed
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.lg,
  },
  instructionsLabel: {
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
  },
  instructions: {
    lineHeight: 24,
  },
  saveButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.xl,
  },
});
