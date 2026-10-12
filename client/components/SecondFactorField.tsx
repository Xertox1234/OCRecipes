import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SecondFactorInput } from "@shared/types/auth";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import {
  emailCodeButtonLabel,
  emailCodeSendError,
  normalizeCodeInput,
} from "@/lib/second-factor-utils";
import type { EmailCodeSource } from "@/hooks/useSignInMethods";
import { MFA_EMAIL_RESEND_COOLDOWN_SECONDS } from "@shared/constants/mfa";

interface SecondFactorFieldProps {
  /** The current proof, or null while incomplete. */
  onChange?: (input: SecondFactorInput | null) => void;
  /**
   * Standalone use (the challenge screen): called at 6 digits, or on Continue
   * for a recovery code. Omit it when a parent form owns the submit button.
   */
  onSubmit?: (input: SecondFactorInput) => void;
  error?: string | null;
  shakeKey?: number;
  busy?: boolean;
  autoFocus?: boolean;
  /**
   * The account's codes come by email: show "Email me a code" (with a resend
   * wait) and no recovery-code link — email accounts have none.
   */
  emailCode?: EmailCodeSource;
}

/**
 * The two-step verification input: a 6-digit code — from an authenticator app
 * (or, behind "Use a recovery code instead", a saved recovery code), or from
 * an email on an email two-step account.
 */
export function SecondFactorField({
  onChange,
  onSubmit,
  error,
  shakeKey,
  busy = false,
  autoFocus = true,
  emailCode,
}: SecondFactorFieldProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [mode, setMode] = useState<"code" | "recovery">("code");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [sent, setSent] = useState(emailCode?.alreadySent === true);
  const [wait, setWait] = useState(
    emailCode?.alreadySent ? MFA_EMAIL_RESEND_COOLDOWN_SECONDS : 0,
  );
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // One tick per second while the resend wait runs.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // No try/finally: React Compiler cannot lower a `finally`.
  const sendCode = async () => {
    if (!emailCode || sending || wait > 0) return;
    haptics.selection();
    setSending(true);
    setSendError(null);
    try {
      const result = await emailCode.send();
      setSentTo(result.emailHint);
      setSent(true);
      setWait(MFA_EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setSendError(emailCodeSendError(err));
    }
    setSending(false);
  };
  const sendLabel = emailCodeButtonLabel(sent, wait);

  const onCode = (raw: string) => {
    const next = normalizeCodeInput(raw);
    setCode(next);
    const complete = next.length === 6;
    onChange?.(complete ? { code: next } : null);
    if (complete && !busy) onSubmit?.({ code: next });
  };

  const onRecovery = (raw: string) => {
    setRecovery(raw);
    const trimmed = raw.trim();
    onChange?.(trimmed ? { recoveryCode: trimmed } : null);
  };

  const toggleMode = () => {
    haptics.selection();
    const next = mode === "code" ? "recovery" : "code";
    setMode(next);
    setCode("");
    setRecovery("");
    onChange?.(null);
  };

  return (
    <View style={styles.container}>
      {mode === "code" ? (
        <TextInput
          leftIcon="shield"
          placeholder="6-digit code"
          value={code}
          onChangeText={onCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          // +2 so a pasted "123 456" isn't cut before normalizing.
          maxLength={8}
          autoFocus={autoFocus}
          editable={!busy}
          error={Boolean(error)}
          accessibilityLabel="6-digit code"
          accessibilityHint={
            emailCode
              ? "Enter the code from the email we sent you"
              : "Enter the code from your authenticator app"
          }
          testID="input-second-factor-code"
        />
      ) : (
        <>
          <TextInput
            leftIcon="key"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={recovery}
            onChangeText={onRecovery}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus={autoFocus}
            editable={!busy}
            error={Boolean(error)}
            accessibilityLabel="Recovery code"
            accessibilityHint="Enter one of the recovery codes you saved"
            testID="input-second-factor-recovery"
          />
          {onSubmit ? (
            <Button
              onPress={() => {
                const trimmed = recovery.trim();
                if (trimmed && !busy) onSubmit({ recoveryCode: trimmed });
              }}
              disabled={!recovery.trim()}
              loading={busy}
              loadingText="Checking…"
            >
              Continue
            </Button>
          ) : null}
        </>
      )}
      <InlineError message={error} shakeKey={shakeKey} />
      {emailCode ? (
        <>
          {sentTo ? (
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {`Code sent to ${sentTo}.`}
            </ThemedText>
          ) : null}
          <InlineError message={sendError} />
          <Pressable
            onPress={() => void sendCode()}
            disabled={busy || sending || wait > 0}
            accessibilityRole="button"
            accessibilityLabel={sendLabel}
            accessibilityState={{ disabled: busy || sending || wait > 0 }}
            style={styles.toggle}
          >
            <ThemedText
              type="small"
              style={{ color: wait > 0 ? theme.textSecondary : theme.link }}
            >
              {sendLabel}
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={toggleMode}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={
            mode === "code"
              ? "Use a recovery code instead"
              : "Use the code from your app instead"
          }
          // minHeight, not hitSlop: the parent clips hitSlop at its bottom edge.
          style={styles.toggle}
        >
          <ThemedText type="small" style={{ color: theme.link }}>
            {mode === "code"
              ? "Use a recovery code instead"
              : "Use the code from your app instead"}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.md },
  toggle: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
