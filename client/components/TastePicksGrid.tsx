import React, { useCallback } from "react";
import { View, FlatList, Pressable, Image, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { RecipeCandidate } from "@shared/types/taste-picks";

interface TastePicksGridProps {
  candidates: RecipeCandidate[];
  selectedIds: Set<number>;
  onToggle: (recipeId: number) => void;
  onEndReached?: () => void;
}

const RecipeCard = React.memo(function RecipeCard({
  item,
  selected,
  onToggle,
}: {
  item: RecipeCandidate;
  selected: boolean;
  onToggle: (id: number) => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={() => onToggle(item.id)}
      accessibilityLabel={
        item.cuisineOrigin
          ? `${item.title}, ${item.cuisineOrigin} cuisine`
          : item.title
      }
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[
        styles.card,
        {
          borderColor: selected ? theme.link : theme.border,
          borderWidth: selected ? 2 : 1,
          backgroundColor: theme.backgroundDefault,
        },
      ]}
    >
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.image}
          resizeMode="cover"
        />
        {selected && (
          <View
            style={[styles.checkmark, { backgroundColor: theme.accentSolid }]}
          >
            <Feather name="check" size={10} color={theme.buttonText} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <ThemedText type="small" numberOfLines={1} style={styles.cardTitle}>
          {item.title}
        </ThemedText>
        {item.cuisineOrigin && (
          <ThemedText
            type="caption"
            numberOfLines={1}
            style={{ color: theme.textSecondary }}
          >
            {item.cuisineOrigin}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
});

export function TastePicksGrid({
  candidates,
  selectedIds,
  onToggle,
  onEndReached,
}: TastePicksGridProps) {
  const renderItem = useCallback(
    ({ item }: { item: RecipeCandidate }) => (
      <RecipeCard
        item={item}
        selected={selectedIds.has(item.id)}
        onToggle={onToggle}
      />
    ),
    [selectedIds, onToggle],
  );

  return (
    <View
      role="group"
      accessibilityLabel="Recipe selections"
      style={styles.container}
    >
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={candidates}
        numColumns={2}
        keyExtractor={(item) => String(item.id)}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        renderItem={renderItem}
        extraData={selectedIds}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const CARD_IMAGE_HEIGHT = 90;

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing["2xl"],
  },
  row: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  card: {
    flex: 1,
    borderRadius: BorderRadius.card,
    overflow: "hidden",
  },
  imageContainer: {
    position: "relative",
  },
  image: {
    height: CARD_IMAGE_HEIGHT,
    width: "100%",
  },
  checkmark: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    padding: Spacing.sm,
    gap: 2,
  },
  cardTitle: {
    fontWeight: "600",
  },
});
