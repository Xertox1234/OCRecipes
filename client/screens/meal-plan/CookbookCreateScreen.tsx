import React, { useState, useCallback, useEffect } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useCreateCookbook,
  useCookbookDetail,
  useUpdateCookbook,
} from "@/hooks/useCookbooks";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { CookbookCreateScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

export default function CookbookCreateScreen() {
  const navigation = useNavigation<CookbookCreateScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookCreate">>();
  const cookbookId = route.params?.cookbookId;
  const isEditMode = !!cookbookId;

  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const createMutation = useCreateCookbook();
  const updateMutation = useUpdateCookbook();
  const { data: existingCookbook } = useCookbookDetail(cookbookId ?? 0);

  const mutation = isEditMode ? updateMutation : createMutation;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Pre-populate form when editing
  useEffect(() => {
    if (isEditMode && existingCookbook && !initialized) {
      setName(existingCookbook.name);
      setDescription(existingCookbook.description || "");
      setInitialized(true);
    }
  }, [isEditMode, existingCookbook, initialized]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !mutation.isPending;

  const handleSubmit = useCallback(() => {
    if (!trimmedName) return;
    setError(null);

    const onSuccess = () => {
      haptics.notification(NotificationFeedbackType.Success);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          isEditMode ? "Cookbook updated" : "Cookbook created",
        );
      }
      navigation.goBack();
    };

    const onError = (err: Error) => {
      haptics.notification(NotificationFeedbackType.Error);
      const msg =
        err instanceof Error
          ? err.message
          : `Failed to ${isEditMode ? "update" : "create"} cookbook`;
      setError(msg);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(`Error: ${msg}`);
      }
    };

    if (isEditMode && cookbookId) {
      updateMutation.mutate(
        {
          id: cookbookId,
          name: trimmedName,
          description: description.trim() || null,
        },
        { onSuccess, onError },
      );
    } else {
      createMutation.mutate(
        {
          name: trimmedName,
          description: description.trim() || undefined,
        },
        { onSuccess, onError },
      );
    }
  }, [
    trimmedName,
    description,
    isEditMode,
    cookbookId,
    haptics,
    createMutation,
    updateMutation,
    navigation,
  ]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <View
        style={{
          flex: 1,
          paddingTop: headerHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
      >
        <ThemedText style={styles.label}>Name</ThemedText>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: withOpacity(theme.text, 0.04),
              color: theme.text,
              borderColor: withOpacity(theme.text, 0.1),
            },
          ]}
          value={name}
          onChangeText={(text) => setName(text.slice(0, NAME_MAX))}
          placeholder="My Cookbook"
          placeholderTextColor={theme.textSecondary}
          maxLength={NAME_MAX}
          accessibilityLabel="Cookbook name"
          aria-invalid={!!error && !trimmedName}
          returnKeyType="next"
          autoFocus={!isEditMode}
        />
        <ThemedText style={[styles.charCount, { color: theme.textSecondary }]}>
          {name.length}/{NAME_MAX}
        </ThemedText>

        <ThemedText style={[styles.label, { marginTop: Spacing.lg }]}>
          Description{" "}
          <ThemedText style={{ color: theme.textSecondary }}>
            (optional)
          </ThemedText>
        </ThemedText>
        <TextInput
          style={[
            styles.input,
            styles.multilineInput,
            {
              backgroundColor: withOpacity(theme.text, 0.04),
              color: theme.text,
              borderColor: withOpacity(theme.text, 0.1),
            },
          ]}
          value={description}
          onChangeText={(text) =>
            setDescription(text.slice(0, DESCRIPTION_MAX))
          }
          placeholder="What's this cookbook about?"
          placeholderTextColor={theme.textSecondary}
          maxLength={DESCRIPTION_MAX}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          accessibilityLabel="Cookbook description"
        />
        <ThemedText style={[styles.charCount, { color: theme.textSecondary }]}>
          {description.length}/{DESCRIPTION_MAX}
        </ThemedText>

        <InlineError message={error} style={{ marginTop: Spacing.md }} />

        <View style={styles.spacer} />

        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[
            styles.submitButton,
            {
              backgroundColor: canSubmit
                ? theme.link
                : withOpacity(theme.link, 0.3),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isEditMode ? "Save changes" : "Create cookbook"}
          accessibilityState={{ disabled: !canSubmit }}
        >
          {mutation.isPending ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText style={styles.submitButtonText}>
              {isEditMode ? "Save Changes" : "Create Cookbook"}
            </ThemedText>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.sm,
  },
  input: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  multilineInput: {
    minHeight: 100,
    paddingTop: Spacing.md,
  },
  charCount: {
    fontSize: 12,
    textAlign: "right",
    marginTop: Spacing.xs,
  },
  spacer: {
    flex: 1,
  },
  submitButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
  },
  submitButtonText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
