import React, { useState, useCallback } from "react";
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
import { useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import type { CookbookCreateScreenNavigationProp } from "@/types/navigation";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

export default function CookbookCreateScreen() {
  const navigation = useNavigation<CookbookCreateScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isSubmitting;

  const handleCreate = useCallback(async () => {
    if (!trimmedName) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await apiRequest("POST", "/api/cookbooks", {
        name: trimmedName,
        description: description.trim() || undefined,
      });

      haptics.notification(NotificationFeedbackType.Success);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility("Cookbook created");
      }

      await queryClient.invalidateQueries({ queryKey: ["cookbooks"] });
      navigation.goBack();
    } catch (err) {
      haptics.notification(NotificationFeedbackType.Error);
      const msg =
        err instanceof Error ? err.message : "Failed to create cookbook";
      setError(msg);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(`Error: ${msg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [trimmedName, description, haptics, queryClient, navigation]);

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
          autoFocus
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
          onPress={handleCreate}
          disabled={!canSubmit}
          style={[
            styles.createButton,
            {
              backgroundColor: canSubmit
                ? theme.link
                : withOpacity(theme.link, 0.3),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create cookbook"
          accessibilityState={{ disabled: !canSubmit }}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText style={styles.createButtonText}>
              Create Cookbook
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
  createButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
  },
  createButtonText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
