import React, { useState, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import { ImpactFeedbackStyle } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useRecipeGenerate } from "@/hooks/useRecipeGenerate";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type AIGenerateNavProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeAIGenerate"
>;
type AIGenerateRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeAIGenerate"
>;

const SUGGESTION_CHIPS = [
  "Quick dinner",
  "Healthy lunch",
  "Comfort food",
  "Dessert",
  "Meal prep",
  "Snack",
];

export default function RecipeAIGenerateScreen() {
  const navigation = useNavigation<AIGenerateNavProp>();
  const route = useRoute<AIGenerateRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const returnToMealPlan = route.params?.returnToMealPlan;
  const generateMutation = useRecipeGenerate();

  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<TextInput>(null);

  const handleChipPress = useCallback(
    (chip: string) => {
      haptics.impact(ImpactFeedbackStyle.Light);
      setPrompt(chip);
      inputRef.current?.focus();
    },
    [haptics],
  );

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) return;

    haptics.selection();

    try {
      const result = await generateMutation.mutateAsync(trimmed);
      navigation.replace("RecipeCreate", { prefill: result, returnToMealPlan });
    } catch {
      // Error is shown via generateMutation.isError
    }
  }, [prompt, haptics, generateMutation, navigation, returnToMealPlan]);

  const isDisabled = prompt.trim().length < 3 || generateMutation.isPending;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingHorizontal: Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Icon section */}
        <View style={styles.iconSection}>
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: withOpacity("#f59e0b", 0.15), // hardcoded — amber tint
              },
            ]}
          >
            <Feather
              name="zap"
              size={32}
              color="#f59e0b" // hardcoded — amber icon
            />
          </View>
        </View>

        {/* Prompt input */}
        <TextInput
          ref={inputRef}
          style={[
            styles.promptInput,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: withOpacity(theme.link, 0.25),
            },
          ]}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What do you want to make? e.g., 'Chicken stir fry with vegetables' or 'a quick weeknight pasta'"
          placeholderTextColor={theme.textSecondary}
          multiline
          autoFocus
          maxLength={500}
          accessibilityLabel="Recipe prompt"
          returnKeyType="default"
          blurOnSubmit={false}
        />

        {/* Suggestion chips */}
        <ThemedText style={[styles.chipLabel, { color: theme.textSecondary }]}>
          Or try:
        </ThemedText>
        <View style={styles.chipsRow}>
          {SUGGESTION_CHIPS.map((chip) => (
            <Pressable
              key={chip}
              onPress={() => handleChipPress(chip)}
              style={[
                styles.chip,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: withOpacity(theme.border, 0.5),
                  borderRadius: BorderRadius.chipFilled,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={chip}
            >
              <ThemedText style={[styles.chipText, { color: theme.text }]}>
                {chip}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {/* Error message */}
        {generateMutation.isError && (
          <Animated.View entering={FadeIn.duration(250)}>
            <ThemedText style={[styles.errorText, { color: theme.error }]}>
              {generateMutation.error instanceof Error
                ? generateMutation.error.message
                : "Something went wrong. Please try again."}
            </ThemedText>
          </Animated.View>
        )}

        {/* Generate button */}
        <Pressable
          onPress={handleGenerate}
          disabled={isDisabled}
          style={[
            styles.generateButton,
            {
              backgroundColor: theme.link,
              borderRadius: BorderRadius.sm,
              opacity: isDisabled ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            generateMutation.isPending
              ? "Creating your recipe..."
              : "Generate Recipe"
          }
        >
          {generateMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator
                size="small"
                color={theme.buttonText}
                style={styles.loadingIndicator}
              />
              <ThemedText
                style={[styles.buttonText, { color: theme.buttonText }]}
              >
                Creating your recipe...
              </ThemedText>
            </View>
          ) : (
            <ThemedText
              style={[styles.buttonText, { color: theme.buttonText }]}
            >
              Generate Recipe
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  iconSection: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  promptInput: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    padding: 16,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minHeight: 100,
    lineHeight: 22,
    marginBottom: Spacing.lg,
    textAlignVertical: "top",
  },
  chipLabel: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    marginBottom: Spacing.sm,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  errorText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  generateButton: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  loadingIndicator: {
    marginRight: Spacing.sm,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
