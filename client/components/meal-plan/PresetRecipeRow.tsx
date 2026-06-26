import React, { useCallback } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  Pressable,
  type ListRenderItemInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  CarouselRecipeCard,
  CARD_WIDTH,
} from "@/components/home/CarouselRecipeCard";
import { CarouselSkeleton } from "@/components/home/CarouselSkeleton";
import { CarouselError } from "@/components/home/CarouselError";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily } from "@/constants/theme";
import { toCarouselCard } from "./recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const SNAP_INTERVAL = CARD_WIDTH + Spacing.md;

interface PresetRecipeRowProps {
  title: string;
  recipes: SearchableRecipe[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenRecipe: (recipe: SearchableRecipe) => void;
  onSeeAll?: () => void;
}

export function PresetRecipeRow({
  title,
  recipes,
  isLoading,
  isError,
  onRetry,
  onOpenRecipe,
  onSeeAll,
}: PresetRecipeRowProps) {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchableRecipe>) => (
      <CarouselRecipeCard
        card={toCarouselCard(item)}
        showActions={false}
        onPress={() => onOpenRecipe(item)}
      />
    ),
    [onOpenRecipe],
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Header title={title} />
        <CarouselSkeleton />
      </View>
    );
  }
  if (isError && recipes.length === 0) {
    return (
      <View style={styles.container}>
        <Header title={title} />
        <CarouselError label={title.toLowerCase()} onRetry={onRetry} />
      </View>
    );
  }
  if (recipes.length === 0) return null; // row hides gracefully (e.g. empty pantry)

  return (
    <View style={styles.container} accessibilityRole="list">
      <Header title={title} onSeeAll={onSeeAll} />
      <FlatList
        data={recipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
        getItemLayout={(_, index) => ({
          length: SNAP_INTERVAL,
          offset: SNAP_INTERVAL * index,
          index,
        })}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

function Header({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={styles.headerRow}>
      <ThemedText type="body" style={[styles.header, { color: theme.text }]}>
        {title}
      </ThemedText>
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${title}`}
          hitSlop={8}
          style={styles.seeAll}
        >
          <ThemedText
            type="caption"
            style={{ color: theme.link, fontFamily: FontFamily.semiBold }}
          >
            See all
          </ThemedText>
          <Feather
            name="chevron-right"
            size={14}
            color={theme.link}
            accessible={false}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  header: { fontFamily: FontFamily.semiBold, fontSize: 17 },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
  listContent: { paddingHorizontal: Spacing.lg },
});
