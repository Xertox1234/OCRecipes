import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import type { SecondFactorInput } from "@shared/types/auth";
import { TextInput } from "@/components/TextInput";
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
   * Standalone use (the challenge screen): called at 6 digits. Omit it when a
   * parent form owns the submit button.
   */
  onSubmit?: (input: SecondFactorInput) => void;
  error?: string | null;
  shakeKey?: number;
  busy?: boolean;
  autoFocus?: boolean;
  /** Where "Email me a code" (with its resend wait) gets a code from. */
  emailCode: EmailCodeSource;
}

/** The two-step verification input: the 6-digit code from an email. */
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
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(emailCode.alreadySent === true);
  const [wait, setWait] = useState(
    emailCode.alreadySent ? MFA_EMAIL_RESEND_COOLDOWN_SECONDS : 0,
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
    if (sending || wait > 0) return;
    haptics.selection();
    setSending(true);
    setSendError(null);
    try {
      const result = await emailCode.send();
      setSentTo(result.emailHint);
      // Once per send — never on mount or a countdown tick.
      AccessibilityInfo.announceForAccessibility(
        `Code sent to ${result.emailHint}.`,
      );
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

  return (
    <View style={styles.container}>
      <TextInput
        leftIcon="shield"
        label="6-digit code"
        placeholder="123456"
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
        accessibilityHint="Enter the code from the email we sent you"
        testID="input-second-factor-code"
      />
      <InlineError message={error} shakeKey={shakeKey} />
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
        // minHeight, not hitSlop: the parent clips hitSlop at its bottom edge.
        style={styles.toggle}
      >
        <ThemedText
          type="small"
          style={{ color: wait > 0 ? theme.textSecondary : theme.link }}
        >
          {sendLabel}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.md },
  toggle: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
