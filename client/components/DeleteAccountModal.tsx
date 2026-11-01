import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Platform,
  AccessibilityInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { CenteredDialog } from "@/components/CenteredDialog";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { useSignedInEmailCode } from "@/hooks/useSignInMethods";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import type { DeleteAccountProof } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api-error";
import { NATIVE_PROVIDERS } from "@/lib/social-sign-in";
import { deleteProofMode } from "@/screens/SignInMethodsScreen-utils";
import type { SecondFactorInput, SignInMethods } from "@shared/types/auth";
import { mapReauthError } from "@/lib/second-factor-utils";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
  /** Resolves false when nothing was deleted (provider sheet cancelled). */
  onConfirm: (
    proof: DeleteAccountProof,
    secondFactor?: SecondFactorInput,
  ) => Promise<boolean>;
  /** Two-step verification is on: a password proof also needs the code. */
  askCode?: boolean;
  /**
   * How the account signs in; undefined while loading (nothing can be
   * confirmed yet). Without a password it confirms with Apple instead.
   */
  signInMethods: SignInMethods | undefined;
  /** Loading the sign-in methods failed; nothing can be confirmed. */
  loadError?: boolean;
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
  signInMethods,
  loadError = false,
  askCode = false,
}: DeleteAccountModalProps) {
  // Set when the account's two-step codes come by email.
  const twoStepEmail = useSignedInEmailCode();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const mode = deleteProofMode(
    signInMethods,
    Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web",
    NATIVE_PROVIDERS,
  );
  const providerName =
    mode.kind === "provider"
      ? mode.provider === "apple"
        ? "Apple"
        : "Google"
      : null;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [needsCode, setNeedsCode] = useState(askCode);
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);

  // Reset state every time the modal opens so re-opening after a wrong-password
  // attempt starts clean.
  useEffect(() => {
    if (visible) {
      setPassword("");
      setShowPassword(false);
      setError(null);
      setIsDeleting(false);
      setNeedsCode(askCode);
      setFactor(null);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(
          "Delete account confirmation. Confirm it's you to continue.",
        );
      }
    }
  }, [visible, askCode]);

  const handleConfirm = useCallback(async () => {
    // Concurrent-submission guard: state updates may lag behind rapid taps,
    // so don't rely on `disabled` alone — bail early if a request is in flight.
    if (isDeleting) return;
    if (mode.kind === "provider") {
      setError(null);
      setIsDeleting(true);
      try {
        // false = the sheet was cancelled; nothing was deleted.
        if (!(await onConfirm({ provider: mode.provider }))) {
          setIsDeleting(false);
        }
      } catch (err) {
        // Static copy only — never the server message.
        setError(
          err instanceof ApiError && err.status === 401
            ? `${providerName} couldn't confirm it's you. Please try again.`
            : "Failed to delete account. Please try again.",
        );
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        setIsDeleting(false);
      }
      return;
    }
    if (mode.kind !== "password") return;
    if (!password || (needsCode && !factor)) {
      setError(
        password ? "Enter the code we email you" : "Password is required",
      );
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError(null);
    setIsDeleting(true);
    // Outside the try: React Compiler can't lower a conditional inside one.
    const proof = needsCode ? factor : null;
    try {
      if (proof) await onConfirm({ password }, proof);
      else await onConfirm({ password });
      // onConfirm is responsible for any post-deletion navigation/state change.
    } catch (err) {
      const mapped = mapReauthError(err);
      // Right password on a 2FA account: keep it, ask for the code too.
      if (mapped?.needsCode) setNeedsCode(true);
      const message =
        err instanceof Error
          ? err.message
          : "Failed to delete account. Please try again.";
      setError(mapped ? mapped.message : message);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setIsDeleting(false);
    }
  }, [
    password,
    onConfirm,
    isDeleting,
    mode,
    providerName,
    haptics,
    needsCode,
    factor,
  ]);

  // Nothing to confirm with while loading, or with no usable method.
  const confirmDisabled =
    isDeleting || mode.kind === "loading" || mode.kind === "reset_only";

  const handleCancel = useCallback(() => {
    if (isDeleting) return;
    onClose();
  }, [isDeleting, onClose]);

  return (
    <CenteredDialog
      visible={visible}
      onRequestClose={handleCancel}
      backdropLabel="Close delete account dialog"
      dialogLabel="Delete account confirmation"
      icon="alert-triangle"
      iconTone="error"
      title="Delete account?"
      message="This will permanently delete your account and all your data — recipes, meal plans, scans, and history. This cannot be undone."
      messageGap={Spacing.lg}
    >
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
            You have an active subscription. Cancel it in the App Store or Play
            Store before deleting — deletion here does not cancel platform
            billing.
          </ThemedText>
        </View>
      )}

      {mode.kind === "password" ? (
        <>
          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
            rightIconAccessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onRightIconPress={() => setShowPassword((s) => !s)}
            label="Password"
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
            accessibilityHint="Enter your current password to confirm account deletion"
            // The InlineError below announces the message; repeating
            // it as errorMessage made VoiceOver read it twice.
            error={!!error}
            testID="delete-account-password-input"
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
              busy={isDeleting}
              autoFocus={!askCode}
              emailCode={twoStepEmail}
            />
          ) : null}
        </>
      ) : (
        <ThemedText
          type="small"
          style={[styles.label, { color: theme.textSecondary }]}
        >
          {mode.kind === "provider"
            ? `Continue with ${providerName} to confirm it's you.`
            : mode.kind === "loading"
              ? loadError
                ? "Couldn't load your sign-in methods. Close this and try again."
                : "Loading…"
              : "Set up a password in Settings → Sign-in methods first."}
        </ThemedText>
      )}

      <InlineError message={error} shakeKey={shakeKey} />

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
          disabled={confirmDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            isDeleting
              ? "Deleting account"
              : providerName
                ? `Confirm with ${providerName}`
                : "Delete account"
          }
          accessibilityState={{
            disabled: confirmDisabled,
            busy: isDeleting,
          }}
          style={[
            styles.flexButton,
            styles.destructiveButton,
            {
              backgroundColor: theme.error,
              opacity: confirmDisabled ? 0.6 : 1,
            },
          ]}
          testID="delete-account-confirm-button"
        >
          <ThemedText
            type="body"
            style={[styles.destructiveText, { color: theme.buttonText }]}
          >
            {isDeleting
              ? "Deleting..."
              : providerName
                ? `Confirm with ${providerName}`
                : "Delete"}
          </ThemedText>
        </Pressable>
      </View>
    </CenteredDialog>
  );
}

const styles = StyleSheet.create({
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
