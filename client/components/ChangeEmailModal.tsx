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
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { ReplacementCodeCard } from "@/components/ReplacementCodeCard";
import type { SecondFactorInput } from "@shared/types/auth";
import {
  isSecondFactorRequired,
  isTwoStepCheckError,
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface ChangeEmailModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Performs the change. Resolves on success (the caller closes the modal and
   * shows the outcome message); rejects on wrong password / duplicate / rate
   * limit so this modal can surface the error and stay open.
   */
  onConfirm: (
    newEmail: string,
    password: string,
    secondFactor?: SecondFactorInput,
  ) => Promise<void | ChangeEmailNeedsSave>;
  /** Two-step verification is on: ask for the code with the password. */
  askCode?: boolean;
  /** The user's current email, shown for context. */
  currentEmail?: string;
}

/**
 * The change went through but used up a recovery code: show its replacement
 * first, then `finish` (close + confirm) once the person has saved it.
 */
export interface ChangeEmailNeedsSave {
  replacementRecoveryCode: string;
  finish: () => void;
}

// Client mirror of the server's `z.string().email()` — immediate feedback so a
// malformed address is caught before the round-trip. The server is the
// authority (see client-mirror-server-validation-signup-email-trap solution).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password-confirmation modal for changing the account email address.
 *
 * Re-authentication (current password) gates the change; the server stores the
 * new address as unverified and emails it a verification link. Cross-platform:
 * uses RN `Modal` + `TextInput` (NOT `Alert.prompt`, which is iOS-only and would
 * crash Android). Mirrors `DeleteAccountModal`'s a11y + keyboard handling.
 */
export function ChangeEmailModal({
  visible,
  onClose,
  onConfirm,
  currentEmail,
  askCode = false,
}: ChangeEmailModalProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each validation reject (not server errors) to shake the error.
  const [shakeKey, setShakeKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsCode, setNeedsCode] = useState(askCode);
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  // A spent recovery code's replacement; `finish` is set when the change itself succeeded.
  const [replacement, setReplacement] = useState<{
    code: string;
    finish?: () => void;
  } | null>(null);

  // Reset every time the modal opens so a re-open after a failed attempt starts
  // clean.
  useEffect(() => {
    if (visible) {
      setNewEmail("");
      setConfirmEmail("");
      setPassword("");
      setShowPassword(false);
      setError(null);
      setIsSubmitting(false);
      setNeedsCode(askCode);
      setFactor(null);
      setReplacement(null);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          "Change email. Enter your new email and current password.",
        );
      }
    }
  }, [visible, askCode]);

  const handleConfirm = useCallback(async () => {
    // Concurrent-submission guard: state updates may lag rapid taps, so don't
    // rely on `disabled` alone.
    if (isSubmitting) return;
    const rejectInput = (message: string) => {
      setError(message);
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    };
    const trimmedEmail = newEmail.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      rejectInput("Enter a valid email address");
      return;
    }
    // Confirm-email guard against a typo: a mistyped new address is mutated
    // immediately and (verification ON) can lock the user out at next login.
    // Compare normalized (trim + lowercase) since the server lowercases anyway.
    if (trimmedEmail.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      rejectInput("Email addresses do not match");
      return;
    }
    if (!password) {
      rejectInput("Password is required");
      return;
    }
    if (needsCode && !factor) {
      rejectInput("Enter the code from your authenticator app");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onConfirm(
        trimmedEmail,
        password,
        needsCode && factor ? factor : undefined,
      );
      // onConfirm closes the modal + surfaces the outcome on success, unless a
      // spent recovery code's replacement must be saved first.
      if (result) {
        setReplacement({
          code: result.replacementRecoveryCode,
          finish: result.finish,
        });
        setIsSubmitting(false);
      }
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setIsSubmitting(false);
      const spent = replacementFromError(err);
      if (spent) setReplacement({ code: spent });
      if (isSecondFactorRequired(err)) {
        // Right password on a 2FA account: keep it, ask for the code too.
        setNeedsCode(true);
        setError("Enter the code from your authenticator app.");
        return;
      }
      if (isTwoStepCheckError(err)) {
        setError(secondFactorErrorMessage(err).message);
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "Could not change your email. Please try again.";
      // Map the API's "<status>: <text>" errors to friendlier copy.
      const friendly = /Invalid credentials/i.test(message)
        ? "Incorrect password. Please try again."
        : /already registered|already in use/i.test(message)
          ? "That email address is already in use."
          : /^429:/.test(message)
            ? "Too many attempts. Please wait a while and try again."
            : "Could not change your email. Please try again.";
      // A server error: Error haptic (above), no shake (the input wasn't rejected).
      setError(friendly);
    }
  }, [
    newEmail,
    confirmEmail,
    password,
    onConfirm,
    isSubmitting,
    haptics,
    needsCode,
    factor,
  ]);

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

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
          accessibilityLabel="Close change email dialog"
          accessibilityRole="button"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.centerWrap} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            accessibilityLabel="Change email"
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
                    { backgroundColor: withOpacity(theme.link, 0.12) },
                  ]}
                >
                  <Feather name="mail" size={28} color={theme.link} />
                </View>
              </View>

              <ThemedText
                type="h4"
                accessibilityRole="header"
                style={styles.title}
              >
                Change email
              </ThemedText>

              <ThemedText
                type="body"
                style={[styles.message, { color: theme.textSecondary }]}
              >
                Enter your new email address and your current password. We will
                send a verification link to the new address.
              </ThemedText>

              {currentEmail ? (
                <ThemedText
                  type="small"
                  style={[styles.currentEmail, { color: theme.textSecondary }]}
                >
                  Current: {currentEmail}
                </ThemedText>
              ) : null}

              <ThemedText
                type="small"
                style={[styles.label, { color: theme.textSecondary }]}
              >
                New email address
              </ThemedText>
              <TextInput
                leftIcon="mail"
                placeholder="you@example.com"
                value={newEmail}
                onChangeText={(text) => {
                  setNewEmail(text);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!isSubmitting}
                accessibilityLabel="New email address"
                error={!!error}
                testID="change-email-new-email-input"
              />

              <ThemedText
                type="small"
                style={[styles.label, { color: theme.textSecondary }]}
              >
                Confirm new email address
              </ThemedText>
              <TextInput
                leftIcon="mail"
                placeholder="you@example.com"
                value={confirmEmail}
                onChangeText={(text) => {
                  setConfirmEmail(text);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!isSubmitting}
                accessibilityLabel="Confirm new email address"
                error={!!error}
                testID="change-email-confirm-email-input"
              />

              <ThemedText
                type="small"
                style={[styles.label, { color: theme.textSecondary }]}
              >
                Current password
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
                editable={!isSubmitting}
                accessibilityLabel="Current password"
                accessibilityHint="Enter your current password to confirm the email change"
                error={!!error}
                errorMessage={error ?? undefined}
                testID="change-email-password-input"
              />

              {needsCode ? (
                <SecondFactorField
                  onChange={setFactor}
                  busy={isSubmitting}
                  autoFocus={!askCode}
                />
              ) : null}

              {replacement ? (
                <ReplacementCodeCard
                  code={replacement.code}
                  onDone={() => {
                    if (replacement.finish) replacement.finish();
                    else setReplacement(null);
                  }}
                />
              ) : null}

              <InlineError message={error} shakeKey={shakeKey} />

              <View style={styles.buttonRow}>
                <Button
                  onPress={handleCancel}
                  variant="secondary"
                  disabled={isSubmitting}
                  style={styles.flexButton}
                  accessibilityLabel="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  onPress={handleConfirm}
                  loading={isSubmitting}
                  loadingText="Updating..."
                  disabled={isSubmitting}
                  style={styles.flexButton}
                  accessibilityLabel={
                    isSubmitting ? "Updating email" : "Update email"
                  }
                >
                  Update email
                </Button>
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
    marginBottom: Spacing.md,
  },
  currentEmail: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  label: {
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  flexButton: {
    flex: 1,
  },
});
