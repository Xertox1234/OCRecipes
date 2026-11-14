import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { FeatureTip } from "@shared/constants/feature-tips";

const ICON: Record<FeatureTip["target"], keyof typeof Feather.glyphMap> = {
  scanBarcode: "maximize",
  scanPhoto: "camera",
  importRecipe: "book-open",
  pantry: "package",
  mealPlan: "calendar",
  voiceRecipe: "mic",
  cookbooks: "bookmark",
};

/**
 * A feature tip. `variant="try"` is a "Try this week" card (title + body);
 * `variant="didYouKnow"` is the tinted "Did you know?" card (body only).
 */
export function DidYouKnowCard({
  tip,
  variant,
  onAction,
}: {
  tip: FeatureTip;
  variant: "try" | "didYouKnow";
  onAction: () => void;
}) {
  const { theme } = useTheme();
  const tinted = variant === "didYouKnow";
  return (
    <View
      style={[
        styles.card,
        tinted
          ? { backgroundColor: theme.backgroundSecondary }
          : {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              borderWidth: 1,
            },
      ]}
    >
      <Feather name={ICON[tip.target]} size={22} color={theme.link} />
      <View style={styles.body}>
        {tinted ? (
          <ThemedText style={[styles.eyebrow, { color: theme.link }]}>
            Did you know?
          </ThemedText>
        ) : (
          <ThemedText style={styles.title}>{tip.title}</ThemedText>
        )}
        <ThemedText style={styles.text}>{tip.body}</ThemedText>
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={tip.actionLabel}
          style={({ pressed }) => [
            styles.action,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <ThemedText style={[styles.actionText, { color: theme.link }]}>
            {tip.actionLabel}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
  },
  body: { flex: 1, gap: 4 },
  eyebrow: {
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: { fontFamily: FontFamily.semiBold, fontSize: 15 },
  text: { fontSize: 14, lineHeight: 21 },
  action: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  actionText: { fontFamily: FontFamily.semiBold, fontSize: 14 },
});
