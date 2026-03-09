import React from "react";
import { StyleSheet, View, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { SubstitutionSuggestion } from "@shared/types/cook-session";

export default function SubstitutionResultScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "SubstitutionResult">>();

  const { result, ingredients } = route.params;
  const { suggestions, dietaryProfileSummary } = result;

  const ingredientMap = new Map(ingredients.map((ing) => [ing.id, ing]));

  const formatDelta = (value: number): string => {
    if (value === 0) return "0";
    const sign = value > 0 ? "+" : "";
    return `${sign}${Math.round(value)}`;
  };

  const renderSuggestion = ({ item }: { item: SubstitutionSuggestion }) => {
    const original = ingredientMap.get(item.originalIngredientId);
    const originalName = original?.name ?? "Unknown";

    return (
      <Card
        style={styles.suggestionCard}
        accessibilityLabel={`Replace ${originalName} with ${item.substitute}. ${item.reason}`}
      >
        {/* Original → Substitute header */}
        <View style={styles.swapRow}>
          <View style={styles.swapItem}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Replace
            </ThemedText>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {originalName}
            </ThemedText>
          </View>

          <Feather name="arrow-right" size={20} color={theme.success} />

          <View style={styles.swapItem}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              With
            </ThemedText>
            <ThemedText
              type="body"
              style={{ fontWeight: "600", color: theme.success }}
            >
              {item.substitute}
            </ThemedText>
          </View>
        </View>

        {/* Ratio */}
        <View
          style={[
            styles.ratioBadge,
            { backgroundColor: withOpacity(theme.link, 0.1) },
          ]}
        >
          <ThemedText
            type="small"
            style={{ color: theme.link, fontWeight: "600" }}
          >
            Ratio: {item.ratio}
          </ThemedText>
        </View>

        {/* Reason */}
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginTop: Spacing.sm }}
        >
          {item.reason}
        </ThemedText>

        {/* Macro delta */}
        <View style={styles.deltaRow}>
          <DeltaChip
            label="Cal"
            value={formatDelta(item.macroDelta.calories)}
            positive={item.macroDelta.calories <= 0}
            theme={theme}
          />
          <DeltaChip
            label="Protein"
            value={`${formatDelta(item.macroDelta.protein)}g`}
            positive={item.macroDelta.protein >= 0}
            theme={theme}
          />
          <DeltaChip
            label="Carbs"
            value={`${formatDelta(item.macroDelta.carbs)}g`}
            positive={item.macroDelta.carbs <= 0}
            theme={theme}
          />
          <DeltaChip
            label="Fat"
            value={`${formatDelta(item.macroDelta.fat)}g`}
            positive={item.macroDelta.fat <= 0}
            theme={theme}
          />
        </View>

        {/* Confidence */}
        <View style={styles.confidenceRow}>
          <View
            style={[
              styles.confidenceDot,
              {
                backgroundColor:
                  item.confidence >= 0.8 ? theme.success : theme.warning,
              },
            ]}
          />
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {item.confidence >= 0.8 ? "High" : "Medium"} confidence
          </ThemedText>
        </View>
      </Card>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={suggestions}
        keyExtractor={(item, index) => `${item.originalIngredientId}-${index}`}
        renderItem={renderSuggestion}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="h2">
              {suggestions.length} Suggestion
              {suggestions.length !== 1 ? "s" : ""}
            </ThemedText>
            {dietaryProfileSummary ? (
              <View
                style={[
                  styles.profileBadge,
                  {
                    backgroundColor: withOpacity(theme.success, 0.1),
                  },
                ]}
              >
                <Feather name="user" size={14} color={theme.success} />
                <ThemedText type="small" style={{ color: theme.success }}>
                  {dietaryProfileSummary}
                </ThemedText>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="check-circle" size={48} color={theme.success} />
            <ThemedText
              type="body"
              style={{
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: Spacing.md,
              }}
            >
              No substitutions needed — your ingredients look great!
            </ThemedText>
          </View>
        }
      />

      {/* Back button */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + Spacing.md,
            backgroundColor: theme.backgroundDefault,
            borderTopColor: withOpacity(theme.border, 0.3),
          },
        ]}
      >
        <Pressable
          style={[styles.backButton, { borderColor: theme.border }]}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back to review"
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={18} color={theme.text} />
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            Back to Review
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function DeltaChip({
  label,
  value,
  positive,
  theme,
}: {
  label: string;
  value: string;
  positive: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const color = positive ? theme.success : theme.error;
  return (
    <View
      style={[styles.deltaChip, { backgroundColor: withOpacity(color, 0.1) }]}
    >
      <ThemedText
        type="small"
        style={{ color, fontWeight: "600", fontSize: 11 }}
      >
        {value}
      </ThemedText>
      <ThemedText type="small" style={{ color, fontSize: 10, opacity: 0.8 }}>
        {label}
      </ThemedText>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  profileBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
  suggestionCard: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  swapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  swapItem: {
    flex: 1,
    gap: 2,
  },
  ratioBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  deltaRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  deltaChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
    gap: 1,
  },
  confidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl * 2,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    borderTopWidth: 1,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
