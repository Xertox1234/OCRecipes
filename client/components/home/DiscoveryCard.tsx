import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeOut } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { FontFamily, Spacing, BorderRadius } from "@/constants/theme";
import type { DiscoveryCard as DiscoveryCardType } from "./discovery-cards-config";

interface DiscoveryCardProps {
  card: DiscoveryCardType;
  onPress: () => void;
  onDismiss: () => void;
  reducedMotion: boolean;
  width: number;
}

export function DiscoveryCard({
  card,
  onPress,
  onDismiss,
  reducedMotion,
  width,
}: DiscoveryCardProps) {
  return (
    <Animated.View
      style={[styles.container, { width }]}
      exiting={reducedMotion ? undefined : FadeOut.duration(200)}
    >
      <LinearGradient
        colors={["#7B2D14", "#B5451C", "#D4683A"]} // hardcoded — terracotta gradient, always dark regardless of mode
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Watermark emoji — decorative, hidden from screen readers */}
      <ThemedText
        style={styles.watermark}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {card.emoji}
      </ThemedText>
      <Pressable
        onPress={onDismiss}
        style={styles.dismissButton}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
      >
        <ThemedText style={styles.dismissX}>✕</ThemedText>
      </Pressable>
      <ThemedText style={styles.eyebrow}>{card.eyebrow}</ThemedText>
      <ThemedText style={styles.headline} numberOfLines={2}>
        {card.headline}
      </ThemedText>
      <ThemedText style={styles.subtitle} numberOfLines={1}>
        {card.subtitle}
      </ThemedText>
      <Pressable
        onPress={onPress}
        style={styles.cta}
        accessibilityRole="button"
        accessibilityLabel={card.ctaLabel}
      >
        <ThemedText style={styles.ctaText}>{card.ctaLabel} →</ThemedText>
      </Pressable>
    </Animated.View>
  );
}

// NOTE: Colours in this file are intentionally hardcoded.
// The card always renders on a dark terracotta gradient background regardless
// of light/dark mode — using theme.text values would be incorrect here.
const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: "hidden",
    padding: Spacing.md,
    minHeight: 120,
  },
  watermark: {
    position: "absolute",
    right: -4,
    bottom: -4,
    fontSize: 64,
    opacity: 0.15,
  },
  dismissButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  dismissX: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 9,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  headline: {
    color: "#FFFFFF", // hardcoded — white text on dark gradient, correct in both modes
    fontSize: 14,
    fontFamily: FontFamily.bold,
    lineHeight: 20,
    paddingRight: 24,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    paddingRight: 32,
    marginBottom: Spacing.md,
    lineHeight: 16,
  },
  cta: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    borderRadius: BorderRadius.chip,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    alignSelf: "flex-start",
  },
  ctaText: {
    color: "#FFFFFF", // hardcoded — white text on dark gradient, correct in both modes
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
});
