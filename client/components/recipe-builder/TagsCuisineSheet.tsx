import React, { useCallback } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { DIET_TAG_OPTIONS } from "./types";
import type { TagsData } from "@/hooks/useRecipeForm";
import type { DietTag } from "./types";

interface TagsCuisineSheetProps {
  data: TagsData;
  onChange: (data: TagsData) => void;
}

function TagsCuisineSheetInner({ data, onChange }: TagsCuisineSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleToggleTag = useCallback(
    (tag: DietTag) => {
      haptics.selection();
      const next = data.dietTags.includes(tag)
        ? data.dietTags.filter((t) => t !== tag)
        : [...data.dietTags, tag];
      onChange({ ...data, dietTags: next });
    },
    [data, onChange, haptics],
  );

  return (
    <BottomSheetScrollView contentContainerStyle={styles.container}>
      {/* Cuisine */}
      <View style={styles.field}>
        <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
          Cuisine
        </ThemedText>
        <BottomSheetTextInput
          style={[
            styles.input,
            {
              backgroundColor: withOpacity(theme.text, 0.04),
              color: theme.text,
              borderColor: withOpacity(theme.text, 0.1),
            },
          ]}
          value={data.cuisine}
          onChangeText={(v) => onChange({ ...data, cuisine: v })}
          placeholder="e.g., Italian, Mexican, Thai"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Cuisine type"
        />
      </View>

      {/* Diet Tags */}
      <View style={styles.field}>
        <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
          Diet Tags
        </ThemedText>
        <View style={styles.tagGrid}>
          {DIET_TAG_OPTIONS.map((tag) => {
            const active = data.dietTags.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => handleToggleTag(tag)}
                style={[
                  styles.dietTag,
                  {
                    backgroundColor: active
                      ? withOpacity(theme.link, 0.15)
                      : withOpacity(theme.text, 0.04),
                    borderColor: active
                      ? theme.link
                      : withOpacity(theme.text, 0.1),
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${active ? "Remove" : "Add"} ${tag} diet tag`}
                accessibilityState={{ selected: active }}
              >
                <ThemedText
                  style={[
                    styles.dietTagText,
                    { color: active ? theme.link : theme.textSecondary },
                  ]}
                >
                  {tag}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </BottomSheetScrollView>
  );
}

export const TagsCuisineSheet = React.memo(TagsCuisineSheetInner);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.xl,
  },
  field: {
    gap: Spacing.sm,
  },
  label: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
  },
  tagGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  dietTag: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
  },
  dietTagText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
});
