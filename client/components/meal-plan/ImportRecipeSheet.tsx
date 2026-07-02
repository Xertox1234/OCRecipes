import React, { useCallback, useState } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import {
  cacheDirectory,
  writeAsStringAsync,
  EncodingType,
} from "expo-file-system/legacy";

import { ThemedText } from "@/components/ThemedText";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  MEAL_LABELS,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";

export const IMPORT_RECIPE_SNAP_POINTS = ["55%"];

interface ImportRecipeSheetContentProps {
  mealType: MealType | null;
  plannedDate: string;
  onDismiss: () => void;
  onNavigateUrlImport: (mealType: MealType, date: string) => void;
  onPhotoImport: (uri: string, mealType: MealType, date: string) => void;
}

export function ImportRecipeSheetContent({
  mealType,
  plannedDate,
  onDismiss,
  onNavigateUrlImport,
  onPhotoImport,
}: ImportRecipeSheetContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const canImportPhoto = usePremiumFeature("recipePhotoImport");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const handleUrlImport = useCallback(() => {
    if (!mealType) return;
    haptics.impact(ImpactFeedbackStyle.Light);
    onDismiss();
    onNavigateUrlImport(mealType, plannedDate);
  }, [haptics, mealType, plannedDate, onDismiss, onNavigateUrlImport]);

  const handlePremiumAction = useCallback(
    async (action: () => Promise<void>) => {
      if (!canImportPhoto) {
        haptics.notification(NotificationFeedbackType.Warning);
        setShowUpgradeModal(true);
        return;
      }
      await action();
    },
    [canImportPhoto, haptics],
  );

  const handleCamera = useCallback(() => {
    void handlePremiumAction(async () => {
      if (!mealType) return;
      haptics.impact(ImpactFeedbackStyle.Light);
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      onDismiss();
      onPhotoImport(result.assets[0].uri, mealType, plannedDate);
    });
  }, [
    handlePremiumAction,
    haptics,
    mealType,
    plannedDate,
    onDismiss,
    onPhotoImport,
  ]);

  const handleGallery = useCallback(() => {
    void handlePremiumAction(async () => {
      if (!mealType) return;
      haptics.impact(ImpactFeedbackStyle.Light);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      onDismiss();
      onPhotoImport(result.assets[0].uri, mealType, plannedDate);
    });
  }, [
    handlePremiumAction,
    haptics,
    mealType,
    plannedDate,
    onDismiss,
    onPhotoImport,
  ]);

  const handleClipboard = useCallback(() => {
    void handlePremiumAction(async () => {
      if (!mealType) return;
      haptics.impact(ImpactFeedbackStyle.Light);
      setClipboardError(null);

      const hasImage = await Clipboard.hasImageAsync();
      if (!hasImage) {
        setClipboardError("No image found in clipboard");
        haptics.notification(NotificationFeedbackType.Error);
        return;
      }

      const clipboardImage = await Clipboard.getImageAsync({
        format: "jpeg",
      });
      if (!clipboardImage?.data) {
        setClipboardError("Could not read clipboard image");
        haptics.notification(NotificationFeedbackType.Error);
        return;
      }

      // Write base64 data to a temp file for upload
      const tempUri = `${cacheDirectory}clipboard_recipe_${Date.now()}.jpg`;
      await writeAsStringAsync(tempUri, clipboardImage.data, {
        encoding: EncodingType.Base64,
      });

      onDismiss();
      onPhotoImport(tempUri, mealType, plannedDate);
    });
  }, [
    handlePremiumAction,
    haptics,
    mealType,
    plannedDate,
    onDismiss,
    onPhotoImport,
  ]);

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";

  const rows = [
    {
      key: "url",
      icon: "link" as const,
      title: "From URL",
      desc: "Paste a recipe link",
      premium: false,
      onPress: handleUrlImport,
    },
    {
      key: "camera",
      icon: "camera" as const,
      title: "From Camera",
      desc: "Snap a cookbook or recipe card",
      premium: true,
      onPress: handleCamera,
    },
    {
      key: "gallery",
      icon: "image" as const,
      title: "From Gallery",
      desc: "Choose a recipe screenshot",
      premium: true,
      onPress: handleGallery,
    },
    {
      key: "clipboard",
      icon: "clipboard" as const,
      title: "From Clipboard",
      desc: "Use a copied recipe image",
      premium: true,
      onPress: handleClipboard,
    },
  ];

  return (
    <>
      <View style={styles.content}>
        <View
          style={[
            styles.dragIndicator,
            { backgroundColor: withOpacity(theme.text, 0.2) },
          ]}
        />
        <ThemedText style={styles.title}>Import Recipe to {label}</ThemedText>
        <View style={styles.options}>
          {rows.map((row) => {
            const isLocked = row.premium && !canImportPhoto;
            return (
              <Pressable
                key={row.key}
                onPress={row.onPress}
                style={[
                  styles.optionRow,
                  { backgroundColor: withOpacity(theme.text, 0.04) },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isLocked ? `${row.title}, premium feature` : row.title
                }
              >
                <Feather name={row.icon} size={20} color={theme.link} />
                <View style={styles.optionText}>
                  <ThemedText style={styles.optionTitle}>
                    {row.title}
                  </ThemedText>
                  <ThemedText
                    style={[styles.optionDesc, { color: theme.textSecondary }]}
                  >
                    {row.desc}
                  </ThemedText>
                </View>
                <Feather
                  name={isLocked ? "lock" : "chevron-right"}
                  size={16}
                  color={theme.textSecondary}
                />
              </Pressable>
            );
          })}
        </View>
        {clipboardError && (
          <ThemedText
            style={[styles.errorText, { color: theme.error }]}
            accessibilityRole="alert"
          >
            {clipboardError}
          </ThemedText>
        )}
      </View>
      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
    alignSelf: "flex-start",
    marginBottom: Spacing.md,
  },
  options: {
    width: "100%",
    gap: Spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.md,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  optionDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  errorText: {
    fontSize: 13,
    marginTop: Spacing.sm,
    alignSelf: "flex-start",
  },
});
