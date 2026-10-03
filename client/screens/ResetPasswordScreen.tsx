import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import { RESET_CODE_LENGTH } from "@shared/constants/password-reset";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  normalizeResetCode,
  validateResetForm,
  getResetErrorMessage,
  resendSecondsRemaining,
  resetPasswordRequest,
} from "./ResetPasswordScreen-utils";
import {
  requestResetCode,
  getResetRequestErrorMessage,
} from "./ForgotPasswordScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

/**
 * Step 2 of password reset: the emailed code plus the new password. Every
 * rejected code shows one uniform message (never "tries used up" — that would
 * reveal a code exists). Success signs nobody in: it resets the stack to Login
 * with the email prefilled and a one-time toast (LoginScreen consumes it).
 */
export default function ResetPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const email = route.params.email;

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // The code was just sent by ForgotPassword, so the cooldown starts now.
  const [lastSentAt, setLastSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const secondsLeft = resendSecondsRemaining(lastSentAt, now);
  useEffect(() => {
    if (secondsLeft === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const onSubmit = async () => {
    if (busy) return;
    setError("");
    const invalid = validateResetForm({ code, password, confirmPassword });
    if (invalid) {
      setError(invalid);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    try {
      await resetPasswordRequest(email, code, password);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.reset({
        index: 0,
        routes: [{ name: "Login", params: { email, passwordReset: true } }],
      });
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      // InlineError announces the message itself — no second announce here.
      setError(getResetErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (resending || secondsLeft > 0) return;
    setError("");
    setResending(true);
    try {
      await requestResetCode(email);
      const sentAt = Date.now();
      setLastSentAt(sentAt);
      setNow(sentAt);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("A new code has been sent.");
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setError(getResetRequestErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing["3xl"],
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText type="h2" style={styles.title}>
            Check your email
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {`If an account uses ${email}, we've sent a 6-digit code. It expires in 15 minutes.`}
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            leftIcon="hash"
            placeholder="6-digit code"
            value={code}
            onChangeText={(v) => setCode(normalizeResetCode(v))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            // +2 so a pasted "123 456" / "123-456" isn't cut off before
            // normalizeResetCode strips the separator.
            maxLength={RESET_CODE_LENGTH + 2}
            editable={!busy}
            testID="input-reset-code"
            accessibilityLabel="6-digit code"
            accessibilityHint="Enter the code from the email"
          />
          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
            rightIconAccessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onRightIconPress={() => setShowPassword(!showPassword)}
            placeholder="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            editable={!busy}
            testID="input-reset-password"
            accessibilityLabel="New password"
            accessibilityHint="At least 8 characters, with a letter and a number"
          />
          <TextInput
            leftIcon="lock"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!busy}
            testID="input-reset-confirm"
            accessibilityLabel="Confirm new password"
            accessibilityHint="Re-enter the new password"
          />
          <InlineError message={error} />
          <Button
            onPress={onSubmit}
            loading={busy}
            loadingText="Resetting password…"
            style={styles.button}
          >
            Reset password
          </Button>
          <Button
            variant="ghost"
            onPress={onResend}
            loading={resending}
            disabled={secondsLeft > 0}
            accessibilityLabel={
              secondsLeft > 0
                ? `Resend code available in ${secondsLeft} seconds`
                : "Resend code"
            }
            style={styles.button}
          >
            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
          </Button>
          <ThemedText
            type="small"
            style={[styles.hint, { color: theme.textSecondary }]}
          >
            Didn&apos;t get it? Check your spam folder, and use the most recent
            email.
          </ThemedText>
          <Button
            variant="ghost"
            onPress={() => navigation.navigate("Login")}
            style={styles.button}
          >
            Back to sign in
          </Button>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing["2xl"], flexGrow: 1 },
  header: { alignItems: "flex-start", marginBottom: Spacing["3xl"] },
  title: { marginBottom: Spacing.xs },
  form: { gap: Spacing.lg },
  button: { marginTop: Spacing.sm },
  hint: { textAlign: "center" },
});
