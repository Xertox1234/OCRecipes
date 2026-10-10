import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SecondFactorInput } from "@shared/types/auth";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import { normalizeCodeInput } from "@/lib/second-factor-utils";

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
}

/**
 * The two-step verification input: a 6-digit authenticator code, or (behind
 * "Use a recovery code instead") one of the saved recovery codes.
 */
export function SecondFactorField({
  onChange,
  onSubmit,
  error,
  shakeKey,
  busy = false,
  autoFocus = true,
}: SecondFactorFieldProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [mode, setMode] = useState<"code" | "recovery">("code");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");

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
          accessibilityHint="Enter the code from your authenticator app"
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
      <Pressable
        onPress={toggleMode}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={
          mode === "code"
            ? "Use a recovery code instead"
            : "Use the code from your app instead"
        }
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ThemedText type="small" style={{ color: theme.link }}>
          {mode === "code"
            ? "Use a recovery code instead"
            : "Use the code from your app instead"}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.md },
});
