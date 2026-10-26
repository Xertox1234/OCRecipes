import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useSignedInEmailCode } from "@/hooks/useSignInMethods";
import type { SecondFactorInput } from "@shared/types/auth";
import {
  isSecondFactorRequired,
  isTwoStepCheckError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import {
  AbsoluteFill,
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
  ) => Promise<void>;
  /** Two-step verification is on: ask for the code with the password. */
  askCode?: boolean;
  /** The user's current email, shown for context. */
  currentEmail?: string;
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
  const twoStepEmail = useSignedInEmailCode();
  const { theme } = useTheme();
  const haptics = useHaptics();
  // Each field shows its own message: on leaving it with text, live once
  // shown, and on Update email for empty fields (form-fields spec §5.1).
  const newEmailField = useFieldValidation((value) => {
    const trimmed = value.trim();
    if (trimmed === "") return "Enter your new email address";
    return EMAIL_RE.test(trimmed) ? null : "Enter a valid email address";
  });
  // Confirm-email guard against a typo: a mistyped new address is mutated
  // immediately and (verification ON) can lock the user out at next login.
  // Compare normalized (trim + lowercase) since the server lowercases anyway.
  const confirmEmailField = useFieldValidation((value) => {
    if (value.trim().toLowerCase() === newEmailField.value.trim().toLowerCase())
      return null;
    return value.trim() === ""
      ? "Confirm your new email address"
      : "Email addresses do not match";
  });
  const passwordField = useFieldValidation((value) =>
    value ? null : "Password is required",
  );
  // Destructured, never read as `field.ref` in render: React Compiler treats an
  // object read through `.ref` as a ref and skips the whole component.
  const { ref: newEmailRef } = newEmailField;
  const { ref: confirmEmailRef } = confirmEmailField;
  const { ref: passwordRef } = passwordField;
  const newEmail = newEmailField.value;
  const password = passwordField.value;
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each validation reject (not server errors) to shake the error.
  const [shakeKey, setShakeKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsCode, setNeedsCode] = useState(askCode);
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);

  // Reset every time the modal opens so a re-open after a failed attempt starts
  // clean.
  useEffect(() => {
    if (visible) {
      setShowPassword(false);
      setError(null);
      setIsSubmitting(false);
      setNeedsCode(askCode);
      setFactor(null);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          "Change email. Enter your new email and current password.",
        );
      }
    }
  }, [visible, askCode]);

  // Each opening starts with empty fields and no field messages. Ref-guarded
  // so it runs once per opening, not on every render the field objects change.
  const fieldsResetOnOpen = useRef(false);
  useEffect(() => {
    if (!visible) {
      fieldsResetOnOpen.current = false;
      return;
    }
    if (fieldsResetOnOpen.current) return;
    fieldsResetOnOpen.current = true;
    newEmailField.reset("");
    confirmEmailField.reset("");
    passwordField.reset("");
  }, [visible, newEmailField, confirmEmailField, passwordField]);

  const handleConfirm = async () => {
    // Concurrent-submission guard: state updates may lag rapid taps, so don't
    // rely on `disabled` alone.
    if (isSubmitting) return;
    const rejectInput = (message: string) => {
      setError(message);
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    };
    const trimmedEmail = newEmail.trim();
    if (!focusFirstInvalid([newEmailField, confirmEmailField, passwordField])) {
      // Each invalid field's message shakes via its own shakeKey; drop a
      // stale server message.
      setError(null);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (needsCode && !factor) {
      rejectInput("Enter the code we email you");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    // Outside the try: React Compiler can't lower a conditional inside one.
    const proof = needsCode && factor ? factor : undefined;
    try {
      // onConfirm closes the modal + surfaces the outcome on success.
      await onConfirm(trimmedEmail, password, proof);
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setIsSubmitting(false);
      if (isSecondFactorRequired(err)) {
        // Right password on a 2FA account: keep it, ask for the code too.
        setNeedsCode(true);
        setError("Enter the code we email you.");
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
  };

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

              <TextInput
                leftIcon="mail"
                label="New email"
                placeholder="you@example.com"
                ref={newEmailRef}
                value={newEmail}
                onChangeText={(text) => {
                  newEmailField.onChangeText(text);
                  if (error) setError(null);
                }}
                onBlur={newEmailField.onBlur}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!isSubmitting}
                accessibilityLabel="New email address"
                error={!!newEmailField.error}
                errorMessage={newEmailField.error ?? undefined}
                testID="change-email-new-email-input"
              />
              <InlineError
                message={newEmailField.error}
                shakeKey={newEmailField.shakeKey}
              />

              <TextInput
                leftIcon="mail"
                label="Confirm new email"
                placeholder="you@example.com"
                ref={confirmEmailRef}
                value={confirmEmailField.value}
                onChangeText={(text) => {
                  confirmEmailField.onChangeText(text);
                  if (error) setError(null);
                }}
                onBlur={confirmEmailField.onBlur}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!isSubmitting}
                accessibilityLabel="Confirm new email address"
                error={!!confirmEmailField.error}
                errorMessage={confirmEmailField.error ?? undefined}
                testID="change-email-confirm-email-input"
              />
              <InlineError
                message={confirmEmailField.error}
                shakeKey={confirmEmailField.shakeKey}
              />

              <TextInput
                leftIcon="lock"
                rightIcon={showPassword ? "eye-off" : "eye"}
                rightIconAccessibilityLabel={
                  showPassword ? "Hide password" : "Show password"
                }
                onRightIconPress={() => setShowPassword((s) => !s)}
                label="Password"
                ref={passwordRef}
                value={password}
                onChangeText={(text) => {
                  passwordField.onChangeText(text);
                  if (error) setError(null);
                }}
                onBlur={passwordField.onBlur}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                editable={!isSubmitting}
                accessibilityLabel="Current password"
                accessibilityHint="Enter your current password to confirm the email change"
                error={!!passwordField.error}
                errorMessage={passwordField.error ?? undefined}
                testID="change-email-password-input"
              />
              <InlineError
                message={passwordField.error}
                shakeKey={passwordField.shakeKey}
              />

              {needsCode ? (
                <ThemedText
                  type="small"
                  style={[styles.label, { color: theme.textSecondary }]}
                >
                  Two-step verification code
                </ThemedText>
              ) : null}
              {needsCode ? (
                <SecondFactorField
                  onChange={setFactor}
                  busy={isSubmitting}
                  autoFocus={!askCode}
                  emailCode={twoStepEmail}
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
    ...AbsoluteFill,
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
