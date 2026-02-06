import React from "react";
import { StyleSheet, View, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";

import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { PhotoIntent } from "@shared/constants/preparation";

type PhotoIntentScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "PhotoIntent"
>;

type RouteParams = {
  imageUri: string;
};

interface IntentOption {
  intent: PhotoIntent;
  label: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  isPrimary?: boolean;
  requiresPremium?: boolean;
}

const INTENT_OPTIONS: IntentOption[] = [
  {
    intent: "log",
    label: "Log this meal",
    description: "Identify foods, get nutrition info, and save to your log",
    icon: "check-circle",
    isPrimary: true,
  },
  {
    intent: "calories",
    label: "Quick calorie check",
    description: "See nutrition info without logging",
    icon: "bar-chart-2",
  },
  {
    intent: "recipe",
    label: "Find recipes",
    description: "Identify ingredients and generate recipes",
    icon: "book-open",
    requiresPremium: true,
  },
  {
    intent: "identify",
    label: "Just identify",
    description: "See what foods are in the photo",
    icon: "search",
  },
];

export default function PhotoIntentScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<PhotoIntentScreenNavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const { features, canGenerateRecipe } = usePremiumContext();

  const { imageUri } = route.params;

  const handleSelectIntent = (option: IntentOption) => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("PhotoAnalysis", {
      imageUri,
      intent: option.intent,
    });
  };

  const isRecipeAvailable = features.recipeGeneration && canGenerateRecipe;

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        {/* Photo Thumbnail */}
        <View style={styles.thumbnailContainer}>
          <Image
            source={{ uri: imageUri }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        </View>

        {/* Intent Options */}
        <View style={styles.optionsContainer}>
          {INTENT_OPTIONS.map((option, index) => {
            const isLocked = option.requiresPremium && !isRecipeAvailable;

            return (
              <Animated.View
                key={option.intent}
                entering={
                  reducedMotion
                    ? undefined
                    : FadeInUp.delay(index * 80).duration(350)
                }
              >
                <Card
                  elevation={option.isPrimary ? 2 : 1}
                  onPress={() => handleSelectIntent(option)}
                  accessibilityLabel={option.label}
                  accessibilityHint={option.description}
                  style={[
                    styles.intentCard,
                    option.isPrimary && {
                      borderColor: theme.success,
                      borderWidth: 2,
                    },
                  ]}
                >
                  <View style={styles.intentCardContent}>
                    <View
                      style={[
                        styles.iconContainer,
                        {
                          backgroundColor: option.isPrimary
                            ? withOpacity(theme.success, 0.12)
                            : withOpacity(theme.link, 0.08),
                        },
                      ]}
                    >
                      <Feather
                        name={option.icon}
                        size={22}
                        color={
                          isLocked
                            ? theme.textSecondary
                            : option.isPrimary
                              ? theme.success
                              : theme.link
                        }
                      />
                    </View>
                    <View style={styles.intentTextContainer}>
                      <ThemedText
                        type="body"
                        style={{
                          fontWeight: "600",
                          color: isLocked ? theme.textSecondary : theme.text,
                        }}
                      >
                        {option.label}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        style={{ color: theme.textSecondary }}
                      >
                        {option.description}
                      </ThemedText>
                    </View>
                    {isLocked && (
                      <View
                        style={[
                          styles.lockBadge,
                          {
                            backgroundColor: withOpacity(theme.warning, 0.15),
                          },
                        ]}
                      >
                        <Feather name="lock" size={14} color={theme.warning} />
                      </View>
                    )}
                  </View>
                </Card>
              </Animated.View>
            );
          })}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  thumbnailContainer: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  thumbnail: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.lg,
  },
  optionsContainer: {
    gap: Spacing.md,
  },
  intentCard: {
    padding: 0,
  },
  intentCardContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  intentTextContainer: {
    flex: 1,
    gap: 2,
  },
  lockBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
});
