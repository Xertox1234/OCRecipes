import React, { useState, useCallback } from "react";
import { StyleSheet, View, FlatList, Pressable, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useSearchExerciseLibrary,
  type ApiExerciseLibraryEntry,
} from "@/hooks/useExerciseLogs";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import type { ActivityStackParamList } from "@/navigation/ActivityStackNavigator";

type Props = NativeStackScreenProps<ActivityStackParamList, "ExerciseSearch">;

export default function ExerciseSearchScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [query, setQuery] = useState("");

  const { data: results = [], isLoading } = useSearchExerciseLibrary(query);

  const handleSelect = useCallback(
    (exercise: ApiExerciseLibraryEntry) => {
      haptics.selection();
      route.params?.onSelect?.({
        name: exercise.name,
        type: exercise.type,
        metValue: exercise.metValue,
      });
      navigation.goBack();
    },
    [haptics, navigation, route.params],
  );

  const renderItem = useCallback(
    ({ item }: { item: ApiExerciseLibraryEntry }) => (
      <Pressable
        onPress={() => handleSelect(item)}
        accessibilityLabel={`${item.name}, ${item.type}, MET ${item.metValue}`}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.resultItem,
          {
            borderBottomColor: theme.border,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View style={styles.resultInfo}>
          <ThemedText style={styles.resultName}>{item.name}</ThemedText>
          <View style={styles.resultMeta}>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {item.type}
              </ThemedText>
            </View>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              MET {item.metValue}
            </ThemedText>
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={theme.textSecondary} />
      </Pressable>
    ),
    [handleSelect, theme],
  );

  const keyExtractor = useCallback(
    (item: ApiExerciseLibraryEntry) => String(item.id),
    [],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Search Input */}
      <View
        style={[
          styles.searchContainer,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
          },
        ]}
      >
        <Feather name="search" size={18} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search exercises..."
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoFocus
          accessibilityLabel="Search exercises"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery("")}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
          >
            <Feather name="x" size={18} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Results */}
      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={{
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        ListEmptyComponent={
          query.length >= 1 && !isLoading ? (
            <View style={styles.emptyContainer}>
              <ThemedText
                type="caption"
                style={{ color: theme.textSecondary, textAlign: "center" }}
              >
                No exercises found for &quot;{query}&quot;
              </ThemedText>
            </View>
          ) : query.length === 0 ? (
            <View style={styles.emptyContainer}>
              <ThemedText
                type="caption"
                style={{ color: theme.textSecondary, textAlign: "center" }}
              >
                Type to search the exercise library
              </ThemedText>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    margin: Spacing.lg,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    height: "100%",
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
  },
  resultInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  resultName: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
    marginBottom: 2,
  },
  resultMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 1,
    borderRadius: BorderRadius.chip,
  },
  emptyContainer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
});
