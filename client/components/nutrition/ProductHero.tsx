import React from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { NutritionData } from "@/hooks/useNutritionLookup";

interface ProductHeroProps {
  nutrition: NutritionData | null | undefined;
  /**
   * Suppresses the serving-size line when `ServingControls` is rendering the
   * same information below. Passed in rather than re-derived: the screen owns
   * the condition — see `showServingControls` in
   * `client/screens/NutritionDetailScreen.tsx` (currently `:265`) rather than
   * restating it here, where it can drift out of sync with the real logic.
   */
  showServingControls: boolean;
  reducedMotion?: boolean;
}

export function ProductHero({
  nutrition,
  showServingControls,
  reducedMotion,
}: ProductHeroProps) {
  const { theme } = useTheme();

  return (
    <>
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(400)}
        style={[
          styles.imageCard,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <FallbackImage
          source={{ uri: nutrition?.imageUrl ?? undefined }}
          style={styles.productImage}
          fallbackIcon="image"
          fallbackIconSize={30}
          resizeMode="contain"
          // Decorative: the product name is announced by the <h2> right
          // below, so a label here would only double-announce it. See
          // FallbackImage's docblock for the RN gating that made the old
          // label inert anyway.
          //
          // testID reaches the real <Image> ONLY — the placeholder branch
          // takes no image props — so a test that finds this node has
          // proved the source wiring, not merely that something rendered.
          testID="product-hero-image"
        />
      </Animated.View>

      <Animated.View
        entering={reducedMotion ? undefined : FadeInUp.delay(100).duration(400)}
      >
        <ThemedText type="h2" style={styles.productName}>
          {nutrition?.productName || "Unknown Product"}
        </ThemedText>
        {nutrition?.brandName ? (
          <ThemedText
            type="small"
            style={[styles.brandName, { color: theme.textSecondary }]}
          >
            {nutrition.brandName}
          </ThemedText>
        ) : null}
        {nutrition?.servingSize && !showServingControls ? (
          <ThemedText
            type="small"
            style={[styles.servingSize, { color: theme.textSecondary }]}
          >
            Serving size: {nutrition.servingSize}
          </ThemedText>
        ) : null}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  imageCard: {
    height: 150,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: Spacing.lg,
  },
  productImage: {
    width: "100%",
    height: 150,
  },
  productName: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  brandName: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  servingSize: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
});
