import React from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { EmptyState } from "@/components/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import {
  useRecipeCommunityStats,
  useRecipeVariants,
} from "@/hooks/useRecipeCommunity";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { RecipeVariantDto } from "@shared/types/recipe-community";

type Route = RouteProp<RootStackParamList, "RecipeVariants">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const THUMB = 56;

/** Public community remixes of one recipe, newest first. */
export default function RecipeVariantsScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderContentInset();
  const { data, isPending, isError, refetch } = useRecipeVariants(
    params.recipeId,
  );

  // Same query the recipe's Community section uses (usually cached). Its
  // uncapped variantCount tells us when the server-capped list is short.
  const stats = useRecipeCommunityStats(params.recipeId, true);

  const openVariant = (id: number) => {
    haptics.selection();
    // push, not navigate: FeaturedRecipeDetail is already in the stack (the
    // original recipe); navigate could return to it instead of opening the remix.
    navigation.push("FeaturedRecipeDetail", {
      recipeId: id,
      recipeType: "community",
    });
  };

  const renderItem = ({ item }: { item: RecipeVariantDto }) => {
    const date = new Date(item.createdAt).toLocaleDateString();
    return (
      <Pressable
        onPress={() => openVariant(item.id)}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: theme.border },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, remixed ${date}`}
      >
        <FallbackImage
          source={{ uri: item.imageUrl }}
          style={styles.thumb}
          fallbackStyle={{ backgroundColor: theme.backgroundSecondary }}
          fallbackIcon="image"
          fallbackIconSize={20}
          contentFit="cover"
        />
        <View style={styles.text}>
          <ThemedText numberOfLines={2} style={styles.title}>
            {item.title}
          </ThemedText>
          <ThemedText style={{ color: theme.textSecondary }}>{date}</ThemedText>
        </View>
      </Pressable>
    );
  };

  // isError before the empty branch: a failed load must not read as "none yet".
  let empty: React.ReactElement | null = null;
  if (isError) {
    empty = (
      <EmptyState
        variant="temporary"
        icon="alert-circle"
        title="Couldn't load community variants."
        description="Check your connection and try again."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  } else if (!isPending) {
    empty = (
      <EmptyState
        variant="temporary"
        icon="shuffle"
        title="No community variants yet."
        description={`Be the first to remix ${params.title}.`}
      />
    );
  }

  const shown = data?.variants.length ?? 0;
  const total = stats.isSuccess ? stats.data.variantCount : 0;
  const footer =
    !isError && total > shown ? (
      <ThemedText style={[styles.footer, { color: theme.textSecondary }]}>
        {`Showing the newest ${shown} of ${total} variants.`}
      </ThemedText>
    ) : null;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
    >
      <FlatList
        {...FLATLIST_DEFAULTS}
        contentContainerStyle={{
          paddingTop: headerInset,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        data={isError ? [] : (data?.variants ?? [])}
        keyExtractor={(v) => String(v.id)}
        renderItem={renderItem}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: BorderRadius.xs,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: "600",
  },
  footer: {
    textAlign: "center",
    padding: Spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
});
