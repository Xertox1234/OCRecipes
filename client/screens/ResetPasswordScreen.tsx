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
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import { Spacing } from "@/constants/theme";
import { ApiError } from "@/lib/api-error";
import { RESET_CODE_LENGTH } from "@shared/constants/password-reset";
import { PASSWORD_MAX, PASSWORD_MIN } from "@shared/constants/password-policy";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  type ResetFormField,
  normalizeResetCode,
  resetCodeError,
  resetPasswordError,
  resetConfirmError,
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
// iOS strong-password suggestions follow the minimum (8 for everyone).
const RESET_PASSWORD_RULES = `minlength: ${PASSWORD_MIN}; maxlength: ${PASSWORD_MAX};`;

export default function ResetPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const email = route.params.email;

  // Each field is checked on leaving it with text or on Reset password
  // (form-fields spec §5.1). The confirm check reads the password's latest
  // value, so it re-checks when the password changes.
  const code = useFieldValidation(resetCodeError);
  const password = useFieldValidation(resetPasswordError);
  const confirm = useFieldValidation((value) =>
    resetConfirmError(value, password.value),
  );
  // Destructured, never read as `field.ref` in render: React Compiler treats an
  // object read through `.ref` as a ref and skips the whole component.
  const { ref: codeRef } = code;
  const { ref: passwordRef } = password;
  const { ref: confirmRef } = confirm;
  const [showPassword, setShowPassword] = useState(false);
  // Server/flow errors only; each field shows its own validation message.
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<ResetFormField | null>(null);
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
    setErrorField(null);
    if (!focusFirstInvalid([code, password, confirm])) {
      // Each invalid field's InlineError shakes via its own shakeKey.
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    // No try/finally: React Compiler cannot lower a `finally` and would skip
    // this component (scripts/check-react-compiler-bailouts.js), so `busy` is
    // reset on each path instead.
    try {
      await resetPasswordRequest(email, code.value, password.value);
      setBusy(false);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.reset({
        index: 0,
        routes: [{ name: "Login", params: { email, passwordReset: true } }],
      });
    } catch (err) {
      setBusy(false);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      // InlineError announces the message itself — no second announce here.
      setError(getResetErrorMessage(err));
      if (err instanceof ApiError && err.code === "INVALID_RESET_CODE") {
        setErrorField("code");
      }
    }
  };

  const onResend = async () => {
    if (resending || secondsLeft > 0) return;
    setError("");
    setErrorField(null);
    setResending(true);
    try {
      await requestResetCode(email);
      setResending(false);
      const sentAt = Date.now();
      setLastSentAt(sentAt);
      setNow(sentAt);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(
        "If an account uses that email, we've sent a new code.",
      );
    } catch (err) {
      setResending(false);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setError(getResetRequestErrorMessage(err));
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
            label="6-digit code"
            placeholder="123456"
            ref={codeRef}
            value={code.value}
            onChangeText={(v) => code.onChangeText(normalizeResetCode(v))}
            onBlur={code.onBlur}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            // +2 so a pasted "123 456" / "123-456" isn't cut off before
            // normalizeResetCode strips the separator.
            maxLength={RESET_CODE_LENGTH + 2}
            editable={!busy}
            error={!!code.error || errorField === "code"}
            errorMessage={
              code.error ?? (errorField === "code" ? error : undefined)
            }
            testID="input-reset-code"
            accessibilityHint="Enter the code from the email"
          />
          <InlineError message={code.error} shakeKey={code.shakeKey} />
          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
            rightIconAccessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onRightIconPress={() => setShowPassword(!showPassword)}
            label="New password"
            ref={passwordRef}
            value={password.value}
            onChangeText={password.onChangeText}
            onBlur={password.onBlur}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            passwordRules={RESET_PASSWORD_RULES}
            editable={!busy}
            error={!!password.error}
            errorMessage={password.error ?? undefined}
            testID="input-reset-password"
            accessibilityHint={`At least ${PASSWORD_MIN} characters`}
          />
          <InlineError message={password.error} shakeKey={password.shakeKey} />
          <TextInput
            leftIcon="lock"
            label="Confirm new password"
            ref={confirmRef}
            value={confirm.value}
            onChangeText={confirm.onChangeText}
            onBlur={confirm.onBlur}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            passwordRules={RESET_PASSWORD_RULES}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!busy}
            error={!!confirm.error}
            errorMessage={confirm.error ?? undefined}
            testID="input-reset-confirm"
            accessibilityHint="Re-enter the new password"
          />
          <InlineError message={confirm.error} shakeKey={confirm.shakeKey} />
          {/* Server and resend errors; field messages sit under each field. */}
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
