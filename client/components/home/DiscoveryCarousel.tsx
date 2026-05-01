import React, { useState } from "react";
import { FlatList, StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { DiscoveryCard } from "./DiscoveryCard";
import { HOME_ACTIONS } from "./action-config";
import { useDiscoveryCards } from "@/hooks/useDiscoveryCards";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";
import type { HomeAction } from "./action-config";

const CARD_H_PADDING = Spacing.lg;
const CARD_GAP = Spacing.sm;
const PEEK = 20;

interface DiscoveryCarouselProps {
  onActionPress: (action: HomeAction) => void;
  usageCounts: Record<string, number>;
}

export function DiscoveryCarousel({
  onActionPress,
  usageCounts,
}: DiscoveryCarouselProps) {
  const { width: screenWidth } = useWindowDimensions();
  const { reducedMotion } = useAccessibility();
  const { theme } = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const { cards, dismiss } = useDiscoveryCards(usageCounts);

  if (cards.length === 0) return null;

  const cardWidth = screenWidth - CARD_H_PADDING * 2 - PEEK;
  const clampedIndex = Math.min(activeIndex, cards.length - 1);

  return (
    <View>
      <ThemedText
        style={[styles.sectionHeader, { color: theme.textSecondary }]}
      >
        DISCOVER
      </ThemedText>
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: CARD_H_PADDING,
          gap: CARD_GAP,
        }}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(
            e.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP),
          );
          setActiveIndex(index);
        }}
        renderItem={({ item }) => {
          const action = HOME_ACTIONS.find((a) => a.id === item.id);
          return (
            <DiscoveryCard
              card={item}
              width={cardWidth}
              reducedMotion={reducedMotion}
              onPress={() => {
                // integrity test in discovery-cards-config.test.ts ensures action is always defined
                action && onActionPress(action);
              }}
              onDismiss={() => {
                dismiss(item.id);
                setActiveIndex((prev) => Math.max(0, prev - 1));
              }}
            />
          );
        }}
        accessibilityRole="list"
        accessibilityLabel="Feature discovery cards"
      />
      <View style={styles.dotsRow}>
        {cards.map((card, i) => (
          <View
            key={card.id}
            style={[
              styles.dot,
              i === clampedIndex
                ? [styles.dotActive, { backgroundColor: theme.link }]
                : { backgroundColor: withOpacity(theme.text, 0.15) },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  dot: {
    height: 5,
    width: 5,
    borderRadius: 2.5,
  },
  dotActive: {
    width: 14,
    borderRadius: 3,
  },
});
