import React, { useCallback, useState } from "react";
import { StyleSheet, View, Pressable, Alert, Linking } from "react-native";
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
import { useToast } from "@/context/ToastContext";
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
import { RECIPE_IMPORT_OPTIONS } from "./recipe-import-options";

export const IMPORT_RECIPE_SNAP_POINTS = ["55%"];

interface ImportRecipeSheetContentProps {
  // Standalone mode: mealType null + plannedDate omitted (Home tab, Recipe
  // Entry Hub). Meal-plan mode: both set, forwarded to the import screens.
  mealType: MealType | null;
  plannedDate?: string;
  onDismiss: () => void;
  onNavigateUrlImport: (mealType: MealType | null, date?: string) => void;
  onPhotoImport: (
    uri: string,
    mealType: MealType | null,
    date?: string,
  ) => void;
}

function ImportRecipeSheetContentInner({
  mealType,
  plannedDate,
  onDismiss,
  onNavigateUrlImport,
  onPhotoImport,
}: ImportRecipeSheetContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const canImportPhoto = usePremiumFeature("recipePhotoImport");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const handleUrlImport = useCallback(() => {
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

  // Permission denial is a blocking system decision (Cancel vs. navigate out
  // to Settings), not a form-validation message — InlineError has no room
  // for an action button, so Alert.alert is the right tool here, matching
  // the pre-consolidation RecipeEntryHubScreen behavior this restores.
  const showPermissionDeniedAlert = useCallback(
    (subject: "Camera" | "Photo Library") => {
      haptics.notification(NotificationFeedbackType.Warning);
      Alert.alert(
        `${subject} Access`,
        `Please enable ${subject.toLowerCase()} access in Settings to import recipes.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ],
      );
    },
    [haptics],
  );

  const handleCamera = useCallback(() => {
    void handlePremiumAction(async () => {
      haptics.impact(ImpactFeedbackStyle.Light);
      let result: ImagePicker.ImagePickerResult;
      try {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          showPermissionDeniedAlert("Camera");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.9,
        });
      } catch {
        // Android rejects launchCameraAsync (rather than no-op'ing like iOS)
        // when the CAMERA manifest permission is denied. Re-check status
        // instead of assuming the rejection was permission-related, so an
        // unrelated failure (e.g. no camera hardware) isn't mislabeled as a
        // Settings problem. The recheck itself is guarded too — if it also
        // throws (e.g. the native permission declaration is missing), don't
        // let that escape as a second unhandled rejection.
        try {
          const { status } = await ImagePicker.getCameraPermissionsAsync();
          if (status !== "granted") {
            showPermissionDeniedAlert("Camera");
          } else {
            // Recheck confirms this wasn't a permission problem — the Settings
            // alert would mislabel it, but the user still needs to know the
            // tap did nothing.
            toast.error("Couldn't open the camera. Please try again.");
          }
        } catch {
          // Cause is undeterminable — can't tell if it's a permission issue,
          // but the user still needs some signal the tap failed.
          toast.error("Couldn't open the camera. Please try again.");
        }
        return;
      }
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
    showPermissionDeniedAlert,
    toast,
  ]);

  const handleGallery = useCallback(() => {
    void handlePremiumAction(async () => {
      haptics.impact(ImpactFeedbackStyle.Light);
      let result: ImagePicker.ImagePickerResult;
      try {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          showPermissionDeniedAlert("Photo Library");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.9,
        });
      } catch {
        // Recheck is guarded too — see the mirrored comment in handleCamera.
        try {
          const { status } =
            await ImagePicker.getMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            showPermissionDeniedAlert("Photo Library");
          } else {
            toast.error("Couldn't open the gallery. Please try again.");
          }
        } catch {
          toast.error("Couldn't open the gallery. Please try again.");
        }
        return;
      }
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
    showPermissionDeniedAlert,
    toast,
  ]);

  const handleClipboard = useCallback(() => {
    void handlePremiumAction(async () => {
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

  const handlers: Record<
    (typeof RECIPE_IMPORT_OPTIONS)[number]["key"],
    { premium: boolean; onPress: () => void }
  > = {
    url: { premium: false, onPress: handleUrlImport },
    camera: { premium: true, onPress: handleCamera },
    gallery: { premium: true, onPress: handleGallery },
    clipboard: { premium: true, onPress: handleClipboard },
  };
  const rows = RECIPE_IMPORT_OPTIONS.map((option) => ({
    key: option.key,
    icon: option.icon,
    title: option.title,
    desc: option.desc,
    ...handlers[option.key],
  }));

  return (
    <>
      {/* accessibilityViewIsModal must live on this inner View —
          BottomSheetModal typechecks the prop but never forwards it
          (verified in @gorhom/bottom-sheet source), so setting it on the
          modal is a silent no-op. iOS-only prop; traps VoiceOver focus. */}
      <View style={styles.content} accessibilityViewIsModal>
        <View
          style={[
            styles.dragIndicator,
            { backgroundColor: withOpacity(theme.text, 0.2) },
          ]}
        />
        <ThemedText style={styles.title}>
          {mealType ? `Import Recipe to ${label}` : "Import a Recipe"}
        </ThemedText>
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

export const ImportRecipeSheetContent = React.memo(
  ImportRecipeSheetContentInner,
);

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
