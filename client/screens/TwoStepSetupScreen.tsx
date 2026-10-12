import React, { useState } from "react";
import { AccessibilityInfo, Alert, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SecondFactorInput } from "@shared/types/auth";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { ReplacementCodeCard } from "@/components/ReplacementCodeCard";
import {
  TotpEnrollmentSteps,
  type TotpEnrollmentStart,
} from "@/components/TotpEnrollmentSteps";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/lib/api-error";
import {
  emailCodeSendError,
  isTwoStepCheckError,
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import { Spacing } from "@/constants/theme";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import {
  finishMessage,
  identityIntro,
  setupTitle,
} from "./TwoStepSetupScreen-utils";
import { useSignedInEmailCode } from "@/hooks/useSignInMethods";

type Props = NativeStackScreenProps<ProfileStackParamList, "TwoStepSetup">;

const ME_KEY = ["/api/auth/me"] as const;

/** Static copy for a failed request on this screen — never the raw response. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "MFA_SETUP_DISABLED")
      return "Two-step verification isn't available yet.";
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
 * 2026-10-12), or turn it off. Older authenticator-app accounts can still
 * move it to a new phone or make new recovery codes.
 */
export default function TwoStepSetupScreen({ route, navigation }: Props) {
  const { mode } = route.params;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const queryClient = useQueryClient();
  const auth = useAuthContext();
  const needsFactor = mode !== "setup";
  // Set when the account's two-step codes come by email.
  const twoStepEmail = useSignedInEmailCode();

  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  // Set once the password (+ factor) step passes: the shared setup steps take over.
  const [start, setStart] = useState<TotpEnrollmentStart | null>(null);
  // Recovery codes on screen and not yet saved (reported by the setup steps).
  const [guard, setGuard] = useState(false);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Email setup: set once the first code went out (the masked address).
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  // Swipe-back, header back or Android back while the codes are unsaved.
  // Done is only enabled once they're ticked as saved, so its goBack() passes.
  usePreventRemove(guard, ({ data }) => {
    Alert.alert(
      "Leave without saving your codes?",
      "They won't be shown again. If you lose this phone without them, you'll have to contact support to get back in.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  const fail = (err: unknown) => {
    setBusy(false);
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    // A recovery code spent on a request that then failed: show its replacement.
    const spent = replacementFromError(err);
    if (spent) setReplacement(spent);
    setError(messageFor(err));
  };

  const finish = (message: string) => {
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(message);
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    navigation.goBack();
  };

  // No try/finally in the handlers: React Compiler cannot lower a `finally`.
  const onConfirmIdentity = async () => {
    if (busy || !password || (needsFactor && !factor)) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "setup") {
        const sent = await auth.startEmailTwoStep(password);
        setEmailSentTo(sent.emailHint);
      } else if (factor) {
        // No `&&`/ternaries in here: React Compiler can't lower them in a try.
        if (mode === "new_phone") {
          const next = await auth.startNewPhone(password, factor);
          if (next.replacementRecoveryCode) {
            setReplacement(next.replacementRecoveryCode);
          }
          setStart({
            kind: "secret",
            secret: { secret: next.secret, otpauthUrl: next.otpauthUrl },
          });
        } else if (mode === "disable") {
          await auth.disableTwoStep(password, factor);
          finish("Two-step verification is off");
          return;
        } else {
          const codes = await auth.replaceRecoveryCodes(password, factor);
          // Straight onto the save step: guarded from the first render.
          setGuard(true);
          setStart({ kind: "codes", codes });
        }
      }
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  };

  // No try/finally: React Compiler cannot lower a `finally`.
  const confirmEmailCode = async (input: SecondFactorInput) => {
    if (busy || !("code" in input)) return;
    setBusy(true);
    setError("");
    try {
      await auth.confirmEmailTwoStep(input.code);
      finish("Two-step verification is on");
    } catch (err) {
      fail(err);
    }
  };

  const confirmCode = async (code: string) =>
    (await auth.confirmTwoStep(code)).recoveryCodes;

  return (
    <ScreenScrollView contentContainerStyle={styles.content}>
      <ThemedText type="h3" accessibilityRole="header">
        {setupTitle(mode)}
      </ThemedText>

      {replacement ? (
        <ReplacementCodeCard
          code={replacement}
          onDone={() => setReplacement(null)}
        />
      ) : null}

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

      {!start && !emailSentTo ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {identityIntro(mode, twoStepEmail !== undefined)}
          </ThemedText>
          <TextInput
            leftIcon="lock"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!busy}
            accessibilityLabel="Password"
          />
          {needsFactor ? (
            <SecondFactorField
              onChange={setFactor}
              busy={busy}
              autoFocus={false}
              emailCode={twoStepEmail}
            />
          ) : null}
          <InlineError message={error} />
          <Button
            onPress={() => void onConfirmIdentity()}
            disabled={!password || (needsFactor && !factor)}
            loading={busy}
            variant={mode === "disable" ? "secondary" : "primary"}
          >
            {mode === "disable" ? "Turn off" : "Continue"}
          </Button>
        </View>
      ) : null}

      {start ? (
        <TotpEnrollmentSteps
          start={start}
          confirm={confirmCode}
          messageFor={messageFor}
          onGuardChange={setGuard}
          onDone={(issued) => finish(finishMessage(mode, issued))}
        />
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.xl },
  section: { gap: Spacing.md },
});
