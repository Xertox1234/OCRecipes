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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useCookbookDetail, useUpdateCookbook } from "@/hooks/useCookbooks";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { CookbookEditScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

export default function CookbookEditScreen() {
  const navigation = useNavigation<CookbookEditScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookEdit">>();
  const { cookbookId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { data: cookbook } = useCookbookDetail(cookbookId);
  const updateMutation = useUpdateCookbook();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Pre-populate form when cookbook data loads
  useEffect(() => {
    if (cookbook && !initialized) {
      setName(cookbook.name);
      setDescription(cookbook.description || "");
      setInitialized(true);
    }
  }, [cookbook, initialized]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !updateMutation.isPending;

  const handleSave = useCallback(() => {
    if (!trimmedName) return;
    setError(null);

    updateMutation.mutate(
      {
        id: cookbookId,
        name: trimmedName,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          haptics.notification(NotificationFeedbackType.Success);
          if (Platform.OS === "ios") {
            AccessibilityInfo.announceForAccessibility("Cookbook updated");
          }
          navigation.goBack();
        },
        onError: (err) => {
          haptics.notification(NotificationFeedbackType.Error);
          const msg =
            err instanceof Error ? err.message : "Failed to update cookbook";
          setError(msg);
          if (Platform.OS === "ios") {
            AccessibilityInfo.announceForAccessibility(`Error: ${msg}`);
          }
        },
      },
    );
  }, [
    trimmedName,
    description,
    cookbookId,
    haptics,
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
          paddingBottom: insets.bottom + Spacing.xl,
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
          onPress={handleSave}
          disabled={!canSubmit}
          style={[
            styles.saveButton,
            {
              backgroundColor: canSubmit
                ? theme.link
                : withOpacity(theme.link, 0.3),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled: !canSubmit }}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText style={styles.saveButtonText}>Save Changes</ThemedText>
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
  saveButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
  },
  saveButtonText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
