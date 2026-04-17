import React, { useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { TagsData } from "@/hooks/useRecipeForm";
import { DIET_TAG_OPTIONS, type DietTag } from "./types";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface TagsStepProps {
  tags: TagsData;
  setTags: (data: TagsData) => void;
}

export default function TagsStep({ tags, setTags }: TagsStepProps) {
  const { theme } = useTheme();

  const handleCuisineChange = useCallback(
    (text: string) => {
      setTags({ ...tags, cuisine: text });
    },
    [tags, setTags],
  );

  const handleTagToggle = useCallback(
    (tag: DietTag) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const isActive = tags.dietTags.includes(tag);
      const nextTags = isActive
        ? tags.dietTags.filter((t) => t !== tag)
        : [...tags.dietTags, tag];
      setTags({ ...tags, dietTags: nextTags });
    },
    [tags, setTags],
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Cuisine section */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: theme.link }]}>
          CUISINE
        </Text>
        <View style={styles.cuisineRow}>
          <TextInput
            style={[
              styles.cuisineInput,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.border, 0.5),
                color: theme.text,
                flex: 1,
              },
            ]}
            value={tags.cuisine}
            onChangeText={handleCuisineChange}
            placeholder="e.g., Italian, Mexican, Thai"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            returnKeyType="done"
            accessibilityLabel="Cuisine type"
            accessibilityHint="Enter the cuisine type for this recipe"
          />
          {tags.cuisine.trim().length > 0 && (
            <View
              style={[
                styles.suggestedBadge,
                { backgroundColor: withOpacity(theme.warning, 0.15) },
              ]}
            >
              <Text style={[styles.suggestedText, { color: theme.warning }]}>
                suggested
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Diet Tags section */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: theme.link }]}>
          DIET TAGS
        </Text>
        <View style={styles.chipsGrid}>
          {DIET_TAG_OPTIONS.map((tag) => {
            const isActive = tags.dietTags.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => handleTagToggle(tag)}
                style={[
                  styles.chip,
                  isActive
                    ? { backgroundColor: theme.link }
                    : {
                        backgroundColor: theme.backgroundSecondary,
                        borderWidth: 1,
                        borderColor: withOpacity(theme.border, 0.5),
                      },
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isActive }}
                accessibilityLabel={tag}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color: isActive ? "#FFFFFF" : theme.text, // hardcoded
                    },
                  ]}
                >
                  {isActive ? `${tag} ✓` : tag}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingBottom: Spacing.xl,
    gap: Spacing["2xl"],
  },
  section: {
    gap: Spacing.sm,
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  cuisineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  cuisineInput: {
    height: Spacing.inputHeight,
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    fontFamily: FontFamily.regular,
    fontSize: 15,
  },
  suggestedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.chip,
  },
  suggestedText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
  },
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
  },
  chipText: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
  },
});
