import React from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useSuccessPop } from "@/hooks/useSuccessAnimation";
import { useToast } from "@/context/ToastContext";
import {
  useRecipeCommunityStats,
  useSetRecipeTried,
} from "@/hooks/useRecipeCommunity";
import {
  triedBarCaption,
  triedButtonA11yLabel,
  triedButtonLabel,
} from "@/components/recipe-community-stats-utils";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";

/** Matches the catalog save bar so content padding stays consistent. */
export const TRIED_BAR_HEIGHT = 72;

interface Props {
  recipeId: number;
  bottomInset: number;
}

/**
 * Sticky "I tried it" toggle for a public community recipe. Shares the stats
 * cache entry with RecipeCommunityStats and renders only while that request
 * succeeds (a 404 refetch — recipe made private — hides it).
 */
export function RecipeTriedBar({ recipeId, bottomInset }: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const stats = useRecipeCommunityStats(recipeId, true);
  const { mutate: setTried } = useSetRecipeTried(recipeId);
  const { trigger: triggerPop, animatedStyle: popStyle } = useSuccessPop(1.2);

  if (!stats.isSuccess) return null;
  const { triedCount, triedByMe } = stats.data;

  const onPress = () => {
    const next = !triedByMe;
    // The pop fires its own Success haptic — one buzz per mark.
    if (next) triggerPop();
    else haptics.impact();
    // No live region covers this change, so announce on both platforms.
    AccessibilityInfo.announceForAccessibility(
      next ? "Marked as tried" : "Removed from tried",
    );
    setTried(next, {
      onError: () => toast.error("Couldn't save — try again"),
    });
  };

  const fg = triedByMe ? theme.buttonText : theme.link;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: bottomInset + Spacing.sm,
          backgroundColor: theme.backgroundRoot,
          borderTopColor: theme.border,
        },
      ]}
    >
      <ThemedText
        style={[styles.caption, { color: theme.textSecondary }]}
        numberOfLines={1}
        accessible={false}
      >
        {triedBarCaption(triedCount)}
      </ThemedText>
      <Animated.View style={popStyle}>
        <PressableScale
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={triedButtonA11yLabel(triedCount)}
          accessibilityState={{ selected: triedByMe }}
          style={[
            styles.button,
            triedByMe
              ? {
                  backgroundColor: theme.accentSolid,
                  borderColor: theme.accentSolid,
                }
              : {
                  backgroundColor: withOpacity(theme.link, 0.08),
                  borderColor: theme.link,
                },
          ]}
        >
          <Feather name="check" size={16} color={fg} accessible={false} />
          <ThemedText style={[styles.buttonText, { color: fg }]}>
            {triedButtonLabel(triedByMe)}
          </ThemedText>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: TRIED_BAR_HEIGHT,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  caption: {
    flex: 1,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  buttonText: {
    fontWeight: "600",
  },
});
