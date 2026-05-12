import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  AccessibilityInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
  /** True when the user has an active paid subscription (shows IAP warning). */
  showSubscriptionWarning?: boolean;
}

/**
 * Password-confirmation modal for permanent account deletion.
 *
 * Implements CCPA/PIPEDA right-to-erasure flow with explicit re-authentication.
 * Cross-platform: uses RN `Modal` + `TextInput` (NOT `Alert.prompt`, which is
 * iOS-only and would crash Android).
 */
export function DeleteAccountModal({
  visible,
  onClose,
  onConfirm,
  showSubscriptionWarning = false,
}: DeleteAccountModalProps) {
  const { theme } = useTheme();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset state every time the modal opens so re-opening after a wrong-password
  // attempt starts clean.
  useEffect(() => {
    if (visible) {
      setPassword("");
      setShowPassword(false);
      setError(null);
      setIsDeleting(false);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          "Delete account confirmation. Enter your password to continue.",
        );
      }
    }
  }, [visible]);

  const handleConfirm = useCallback(async () => {
    // Concurrent-submission guard: state updates may lag behind rapid taps,
    // so don't rely on `disabled` alone — bail early if a request is in flight.
    if (isDeleting) return;
    if (!password) {
      setError("Password is required");
      return;
    }
    setError(null);
    setIsDeleting(true);
    try {
      await onConfirm(password);
      // onConfirm is responsible for any post-deletion navigation/state change.
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to delete account. Please try again.";
      // Surface a friendlier message for wrong-password (401) responses.
      const friendly = /Invalid credentials/i.test(message)
        ? "Incorrect password. Please try again."
        : message;
      setError(friendly);
      setIsDeleting(false);
    }
  }, [password, onConfirm, isDeleting]);

  const handleCancel = useCallback(() => {
    if (isDeleting) return;
    onClose();
  }, [isDeleting, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.kav}
      >
        <Pressable
          style={[
            styles.backdrop,
            // hardcoded — modal backdrops use a fixed dim regardless of theme
            { backgroundColor: "rgba(0,0,0,0.55)" },
          ]}
          onPress={handleCancel}
          accessibilityLabel="Close delete account dialog"
          accessibilityRole="button"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.centerWrap} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            accessibilityLabel="Delete account confirmation"
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              <View style={styles.iconContainer}>
                <View
                  style={[
                    styles.iconCircle,
                    { backgroundColor: withOpacity(theme.error, 0.12) },
                  ]}
                >
                  <Feather
                    name="alert-triangle"
                    size={28}
                    color={theme.error}
                  />
                </View>
              </View>

              <ThemedText
                type="h4"
                accessibilityRole="header"
                style={styles.title}
              >
                Delete account?
              </ThemedText>

              <ThemedText
                type="body"
                style={[styles.message, { color: theme.textSecondary }]}
              >
                This will permanently delete your account and all your data —
                recipes, meal plans, scans, and history. This cannot be undone.
              </ThemedText>

              {showSubscriptionWarning && (
                <View
                  style={[
                    styles.warningBox,
                    {
                      backgroundColor: withOpacity(theme.warning, 0.08),
                      borderColor: withOpacity(theme.warning, 0.4),
                    },
                  ]}
                  accessibilityRole="alert"
                >
                  <Feather
                    name="info"
                    size={16}
                    color={theme.warning}
                    accessible={false}
                  />
                  <ThemedText
                    type="small"
                    style={[styles.warningText, { color: theme.text }]}
                  >
                    You have an active subscription. Cancel it in the App Store
                    or Play Store before deleting — deletion here does not
                    cancel platform billing.
                  </ThemedText>
                </View>
              )}

              <ThemedText
                type="small"
                style={[styles.label, { color: theme.textSecondary }]}
              >
                Enter your password to confirm
              </ThemedText>
              <TextInput
                leftIcon="lock"
                rightIcon={showPassword ? "eye-off" : "eye"}
                rightIconAccessibilityLabel={
                  showPassword ? "Hide password" : "Show password"
                }
                onRightIconPress={() => setShowPassword((s) => !s)}
                placeholder="Password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (error) setError(null);
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                editable={!isDeleting}
                accessibilityLabel="Password"
                accessibilityHint="Enter your current password to confirm account deletion"
                error={!!error}
                errorMessage={error ?? undefined}
                testID="delete-account-password-input"
              />

              <InlineError message={error} />

              <View style={styles.buttonRow}>
                <Button
                  onPress={handleCancel}
                  variant="secondary"
                  disabled={isDeleting}
                  style={styles.flexButton}
                  accessibilityLabel="Cancel"
                >
                  Cancel
                </Button>
                <Pressable
                  onPress={handleConfirm}
                  disabled={isDeleting}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isDeleting ? "Deleting account" : "Delete account"
                  }
                  accessibilityState={{
                    disabled: isDeleting,
                    busy: isDeleting,
                  }}
                  style={[
                    styles.flexButton,
                    styles.destructiveButton,
                    {
                      backgroundColor: theme.error,
                      opacity: isDeleting ? 0.6 : 1,
                    },
                  ]}
                  testID="delete-account-confirm-button"
                >
                  <ThemedText
                    type="body"
                    style={[
                      styles.destructiveText,
                      { color: theme.buttonText },
                    ]}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "90%",
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  scrollContent: {
    padding: Spacing.xl,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    textAlign: "center",
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.sm,
  },
  message: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.input,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.lg,
  },
  warningText: {
    flex: 1,
    lineHeight: 18,
  },
  label: {
    marginBottom: Spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  flexButton: {
    flex: 1,
  },
  destructiveButton: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveText: {
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
});
