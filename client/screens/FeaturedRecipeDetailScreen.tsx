import React, { useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { getApiUrl } from "@/lib/query-client";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { CommunityRecipe } from "@shared/schema";

type FeaturedRecipeDetailRouteProp = RouteProp<
  RootStackParamList,
  "FeaturedRecipeDetail"
>;

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

function InfoChip({ icon, text }: { icon: FeatherIconName; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.backgroundSecondary }]}>
      <Feather name={icon} size={14} color={theme.textSecondary} />
      <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>
        {text}
      </ThemedText>
    </View>
  );
}

export default function FeaturedRecipeDetailScreen() {
  const route = useRoute<FeaturedRecipeDetailRouteProp>();
  const navigation = useNavigation();
  const { recipeId } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const {
    data: recipe,
    isLoading,
    error,
  } = useQuery<CommunityRecipe>({
    queryKey: [`/api/recipes/${recipeId}`],
  });

  const dismiss = useCallback(() => navigation.goBack(), [navigation]);

  const imageUri = useMemo(
    () => (recipe?.imageUrl ? `${getApiUrl()}${recipe.imageUrl}` : null),
    [recipe?.imageUrl],
  );

  const uniqueTags = useMemo(
    () => [...new Set(recipe?.dietTags ?? [])],
    [recipe?.dietTags],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Close button — floats over hero image */}
      <View style={[styles.sheetHeader, { top: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          accessibilityLabel="Close"
          accessibilityRole="button"
          style={styles.closeButton}
        >
          <Feather
            name="chevron-down"
            size={20}
            color="#fff" // hardcoded — white icon on dark overlay
          />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.link} />
        </View>
      ) : error || !recipe ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={theme.textSecondary} />
          <ThemedText
            style={{ marginTop: Spacing.sm, color: theme.textSecondary }}
          >
            Recipe not found
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingBottom: insets.bottom + Spacing.xl,
          }}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
        >
          {/* Hero image */}
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.heroPlaceholder,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <Feather name="image" size={48} color={theme.textSecondary} />
            </View>
          )}

          <View style={styles.content}>
            {/* Title */}
            <ThemedText type="h3" style={styles.title}>
              {recipe.title}
            </ThemedText>

            {/* Description */}
            {recipe.description ? (
              <ThemedText
                style={[styles.description, { color: theme.textSecondary }]}
              >
                {recipe.description}
              </ThemedText>
            ) : null}

            {/* Info chips */}
            <View style={styles.chipRow}>
              {recipe.difficulty ? (
                <InfoChip icon="bar-chart-2" text={recipe.difficulty} />
              ) : null}
              {recipe.timeEstimate ? (
                <InfoChip icon="clock" text={recipe.timeEstimate} />
              ) : null}
              {recipe.servings ? (
                <InfoChip icon="users" text={`${recipe.servings} servings`} />
              ) : null}
            </View>

            {/* Diet tags */}
            {uniqueTags.length > 0 ? (
              <View style={styles.tagRow}>
                {uniqueTags.map((tag) => (
                  <View
                    key={tag}
                    style={[
                      styles.tag,
                      {
                        backgroundColor: withOpacity(theme.link, 0.1),
                      },
                    ]}
                  >
                    <ThemedText style={[styles.tagText, { color: theme.link }]}>
                      {tag}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Instructions */}
            <Card elevation={1} style={styles.instructionsCard}>
              <ThemedText type="h4" style={styles.sectionTitle}>
                Instructions
              </ThemedText>
              <ThemedText style={styles.instructions}>
                {recipe.instructions}
              </ThemedText>
            </Card>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sheetHeader: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  heroImage: {
    width: "100%",
    height: 250,
  },
  heroPlaceholder: {
    width: "100%",
    height: 200,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  chipText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  tag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  tagText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  instructionsCard: {
    padding: Spacing.lg,
  },
  instructions: {
    fontSize: 15,
    lineHeight: 24,
  },
});
