import React, { useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useAuthContext } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, BorderRadius } from "@/constants/theme";
import { TOTP_CODE_LENGTH } from "@shared/constants/mfa";
import type { MfaProof, User } from "@shared/types/auth";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  type MfaInputMode,
  getMfaErrorMessage,
  isCompleteCode,
  normalizeCodeInput,
} from "./MfaChallengeScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "MfaChallenge">;

/**
 * The second step of signing in to an account with two-step verification:
 * a 6-digit code from the authenticator app, or a one-time recovery code.
 * Reached from every sign-in path (password, Google/Apple, linking).
 */
export default function MfaChallengeScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { verifySecondFactor, finishSignIn } = useAuthContext();
  const { challenge } = route.params;

  const [mode, setMode] = useState<MfaInputMode>("code");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replacement, setReplacement] = useState<{
    code: string;
    user: User;
    token: string;
  } | null>(null);
  // Synchronous guard: auto-submit fires from onChangeText, and `busy` state
  // lags behind fast input (a paste plus a keystroke would submit twice).
  const submittingRef = useRef(false);

  const submit = async (proof: MfaProof) => {
    if (submittingRef.current || expired) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    const done = () => {
      submittingRef.current = false;
      setBusy(false);
    };
    // No try/finally: React Compiler cannot lower a `finally` and would skip
    // this screen (scripts/check-react-compiler-bailouts.js).
    try {
      const result = await verifySecondFactor(challenge, proof);
      done();
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      if (result.replacementRecoveryCode) {
        // Show the new code BEFORE signing in — finishSignIn swaps the
        // navigator to the app and this screen goes away.
        setReplacement({
          code: result.replacementRecoveryCode,
          user: result.user,
          token: result.token,
        });
        AccessibilityInfo.announceForAccessibility(
          "Signed in. Your recovery code was used. Save the new code shown on screen.",
        );
        return;
      }
      await finishSignIn(result.user, result.token);
    } catch (err) {
      done();
      const { message, restart } = getMfaErrorMessage(err, mode);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setError(message);
      setExpired(restart);
      setCode("");
    }
  };

  const onCodeChange = (raw: string) => {
    const next = normalizeCodeInput(raw);
    setCode(next);
    if (isCompleteCode(next)) void submit({ code: next });
  };

  const onCopy = async () => {
    if (!replacement) return;
    await Clipboard.setStringAsync(replacement.code);
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    AccessibilityInfo.announceForAccessibility("Recovery code copied");
  };

  if (replacement) {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.content,
            {
              paddingTop: insets.top + Spacing["3xl"],
              paddingBottom: insets.bottom + Spacing["2xl"],
            },
          ]}
        >
          <View style={styles.header}>
            <ThemedText type="h2" style={styles.title}>
              Save your new recovery code
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Your recovery code was used, so it no longer works. Here&apos;s a
              new one — save it now. You won&apos;t see it again.
            </ThemedText>
          </View>
          <View
            style={[
              styles.codeCard,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <ThemedText
              type="h3"
              selectable
              style={styles.codeText}
              accessibilityLabel={`New recovery code: ${replacement.code.split("").join(" ")}`}
            >
              {replacement.code}
            </ThemedText>
          </View>
          <View style={styles.form}>
            <Button variant="outline" onPress={onCopy} style={styles.button}>
              Copy code
            </Button>
            <Button
              onPress={() => finishSignIn(replacement.user, replacement.token)}
              style={styles.button}
            >
              I&apos;ve saved it
            </Button>
          </View>
        </View>
      </ThemedView>
    );
  }

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
            Two-step verification
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {mode === "code"
              ? "Enter the 6-digit code from your authenticator app."
              : "Enter one of the recovery codes you saved when you turned on two-step verification."}
          </ThemedText>
        </View>

        <View style={styles.form}>
          {mode === "code" ? (
            <TextInput
              leftIcon="shield"
              placeholder="6-digit code"
              value={code}
              onChangeText={onCodeChange}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              // +2 so a pasted "123 456" isn't cut off before normalizing.
              maxLength={TOTP_CODE_LENGTH + 2}
              editable={!busy && !expired}
              testID="input-mfa-code"
              accessibilityLabel="6-digit code"
              accessibilityHint="Enter the code from your authenticator app"
            />
          ) : (
            <>
              <TextInput
                leftIcon="key"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={recoveryCode}
                onChangeText={setRecoveryCode}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => submit({ recoveryCode })}
                editable={!busy && !expired}
                testID="input-mfa-recovery"
                accessibilityLabel="Recovery code"
                accessibilityHint="Enter one of your saved recovery codes"
              />
              <Button
                onPress={() => submit({ recoveryCode })}
                loading={busy}
                loadingText="Checking…"
                disabled={expired || recoveryCode.trim() === ""}
                style={styles.button}
              >
                Verify
              </Button>
            </>
          )}
          <InlineError message={error} />
          {expired ? (
            <Button
              onPress={() => navigation.navigate("Login")}
              style={styles.button}
            >
              Back to sign in
            </Button>
          ) : (
            <Button
              variant="ghost"
              onPress={() => {
                setError("");
                setMode(mode === "code" ? "recovery" : "code");
              }}
              style={styles.button}
            >
              {mode === "code"
                ? "Use a recovery code instead"
                : "Use your authenticator app instead"}
            </Button>
          )}
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
  codeCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  codeText: { letterSpacing: 1 },
});
