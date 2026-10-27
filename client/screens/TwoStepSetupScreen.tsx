import React, { useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SecondFactorInput } from "@shared/types/auth";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/lib/api-error";
import {
  ENTER_PASSWORD,
  ENTER_TWO_STEP_CODE,
  emailCodeSendError,
  isTwoStepCheckError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import { Spacing } from "@/constants/theme";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { identityIntro, setupTitle } from "./TwoStepSetupScreen-utils";
import { useSignedInEmailCode } from "@/hooks/useSignInMethods";

type Props = NativeStackScreenProps<ProfileStackParamList, "TwoStepSetup">;

const ME_KEY = ["/api/auth/me"] as const;

/** Static copy for a failed request on this screen — never the raw response. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "UNAUTHORIZED")
      return "Incorrect password. Please try again.";
    if (err.code === "MFA_NEEDS_PASSWORD")
      return "Set a password first — two-step verification protects password sign-in.";
    if (err.code === "MFA_ALREADY_ENABLED")
      return "Two-step verification is already on.";
    if (err.code === "MFA_NOT_ENABLED") return "Two-step verification is off.";
    if (err.code === "EMAIL_NOT_VERIFIED")
      return "Confirm your email address first, so the codes reach you.";
    if (err.code === "MFA_EMAIL_DAILY_LIMIT") return emailCodeSendError(err);
    if (isTwoStepCheckError(err)) return secondFactorErrorMessage(err).message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Two-step verification: turn it on (codes by email — owner ruling 4,
 * 2026-10-12), or turn it off.
 */
export default function TwoStepSetupScreen({ route, navigation }: Props) {
  const { mode } = route.params;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const queryClient = useQueryClient();
  const auth = useAuthContext();
  const needsFactor = mode === "disable";
  const twoStepEmail = useSignedInEmailCode();

  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Bumped on each validation reject (never a server error) to shake it.
  const [shakeKey, setShakeKey] = useState(0);
  // Email setup: set once the first code went out (the masked address).
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const fail = (err: unknown) => {
    setBusy(false);
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    setError(messageFor(err));
  };

  const finish = (message: string) => {
    // The toast owns the feedback: it buzzes Success, announces on iOS, and is
    // a live region on Android — doing either here too doubled both.
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    navigation.goBack();
  };

  // No try/finally in the handlers: React Compiler cannot lower a `finally`.
  const onConfirmIdentity = async () => {
    if (busy) return;
    // The button stays pressable: an empty field waits for it, then says
    // what's missing (form-fields spec §5.1, as ConnectAccount does).
    if (!password || (needsFactor && !factor)) {
      setError(password ? ENTER_TWO_STEP_CODE : ENTER_PASSWORD);
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "setup") {
        const sent = await auth.startEmailTwoStep(password);
        setEmailSentTo(sent.emailHint);
        // Same words SecondFactorField announces on a resend.
        AccessibilityInfo.announceForAccessibility(
          `Code sent to ${sent.emailHint}.`,
        );
      } else if (factor) {
        await auth.disableTwoStep(password, factor);
        finish("Two-step verification is off");
        return;
      }
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  };

  // No try/finally: React Compiler cannot lower a `finally`.
  const confirmEmailCode = async (input: SecondFactorInput) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await auth.confirmEmailTwoStep(input.code);
      finish("Two-step verification is on");
    } catch (err) {
      fail(err);
    }
  };

  return (
    <ScreenScrollView contentContainerStyle={styles.content}>
      <ThemedText type="h3" accessibilityRole="header">
        {setupTitle(mode)}
      </ThemedText>

      {emailSentTo ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {`We emailed a 6-digit code to ${emailSentTo}. Enter it below.`}
          </ThemedText>
          <SecondFactorField
            onSubmit={(input) => void confirmEmailCode(input)}
            error={error}
            busy={busy}
            emailCode={{
              send: () => auth.startEmailTwoStep(password),
              alreadySent: true,
            }}
          />
        </View>
      ) : null}

      {!emailSentTo ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {identityIntro(mode)}
          </ThemedText>
          <TextInput
            leftIcon="lock"
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void onConfirmIdentity()}
            editable={!busy}
          />
          {needsFactor ? (
            <SecondFactorField
              onChange={setFactor}
              busy={busy}
              autoFocus={false}
              emailCode={twoStepEmail}
            />
          ) : null}
          <InlineError message={error} shakeKey={shakeKey} />
          <Button
            onPress={() => void onConfirmIdentity()}
            loading={busy}
            variant={mode === "disable" ? "secondary" : "primary"}
          >
            {mode === "disable" ? "Turn off" : "Continue"}
          </Button>
        </View>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.xl },
  section: { gap: Spacing.md },
});
