import React, { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SignedInResult } from "@shared/types/auth";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { TotpEnrollmentSteps } from "@/components/TotpEnrollmentSteps";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  PASSWORD_MAX,
  PASSWORD_MIN_SINGLE_FACTOR,
} from "@shared/constants/password-policy";
import { validateNewPassword } from "./LoginScreen-utils";
import {
  closesTwoStep,
  isPassExpired,
  PASS_EXPIRED_MESSAGE,
  showTwoStepChoice,
  upgradeMessageFor,
} from "./PasswordUpgradeScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "PasswordUpgrade">;

type View_ = "choose" | "two-step" | "password";

// iOS strong-password suggestions honour these (spec §7).
const NEW_PASSWORD_RULES = `minlength: ${PASSWORD_MIN_SINGLE_FACTOR}; maxlength: ${PASSWORD_MAX};`;

/**
 * A correct password under 15 on an account without two-step (password
 * policy spec §5.2, §6): sign-in stops here with a short-lived pass. Turning
 * on two-step, or choosing a 15+ password, finishes the sign-in. The pass
 * lives only in this screen's route params — never in storage.
 */
export default function PasswordUpgradeScreen({ route, navigation }: Props) {
  const { pass, canUseTwoStep, purpose } = route.params;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const auth = useAuthContext();

  const [view, setView] = useState<View_>("choose");
  const [twoStepClosed, setTwoStepClosed] = useState(false);
  const [secret, setSecret] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  // Held, not used, until the recovery codes are saved: signing in swaps the
  // whole navigator and would unmount this screen with the codes unsaved.
  const [session, setSession] = useState<SignedInResult | null>(null);
  const [guard, setGuard] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);

  // Swipe-back or header back while recovery codes are on screen unsaved.
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
    if (isPassExpired(err)) setExpired(true);
    if (closesTwoStep(err)) {
      setTwoStepClosed(true);
      setView("choose");
    }
    setError(upgradeMessageFor(err));
  };

  // No try/finally, and no ternary/&&/?. inside a try: React Compiler can't
  // lower them.
  const onTwoStep = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const staged = await auth.upgradeStartTwoStep(pass);
      setSecret(staged);
      setView("two-step");
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  };

  const confirmCode = async (code: string) => {
    const result = await auth.upgradeConfirmTwoStep(pass, code);
    setSession(result.session ?? null);
    return result.recoveryCodes;
  };

  // The setup steps show this copy for a failed code check; an expired pass
  // also needs the way back to sign-in.
  const confirmMessageFor = (err: unknown) => {
    if (isPassExpired(err)) setExpired(true);
    return upgradeMessageFor(err);
  };

  // No session: the server refused it after two-step went on (a reset
  // landed) — the codes are saved, so the way on is sign-in.
  const onCodesSaved = () => {
    if (session) void auth.finishSignIn(session.user, session.token);
    else {
      setError(PASS_EXPIRED_MESSAGE);
      setExpired(true);
    }
  };

  const onSetPassword = async () => {
    if (busy) return;
    const problem = validateNewPassword(newPassword, confirmNewPassword, {
      min: PASSWORD_MIN_SINGLE_FACTOR,
      context: "single_factor",
    });
    if (problem) {
      setError(problem);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Signs in: the navigator swaps to the app on success.
      await auth.upgradeSetPassword(pass, newPassword);
    } catch (err) {
      fail(err);
    }
  };

  const choose = (next: View_) => {
    setError("");
    setView(next);
  };

  return (
    <ScreenScrollView contentContainerStyle={styles.content}>
      <ThemedText type="h3" accessibilityRole="header">
        Make your sign-in stronger
      </ThemedText>

      {view === "choose" ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Your password is shorter than 15 characters. To keep signing in with
            it, turn on two-step verification, or choose a longer password.
          </ThemedText>
          {purpose === "link" ? (
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              After this, tap Google or Apple again to connect it.
            </ThemedText>
          ) : null}
          {showTwoStepChoice(canUseTwoStep, twoStepClosed) ? (
            <Button
              onPress={() => void onTwoStep()}
              loading={busy}
              disabled={expired}
            >
              Turn on two-step verification
            </Button>
          ) : null}
          <Button
            variant="outline"
            onPress={() => choose("password")}
            disabled={busy || expired}
          >
            Choose a longer password
          </Button>
        </View>
      ) : null}

      {view === "two-step" && secret ? (
        <TotpEnrollmentSteps
          start={{ kind: "secret", secret }}
          confirm={confirmCode}
          messageFor={confirmMessageFor}
          onGuardChange={setGuard}
          onDone={onCodesSaved}
        />
      ) : null}

      {view === "password" ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Use at least {PASSWORD_MIN_SINGLE_FACTOR} characters. A short phrase
            of a few words is easy to remember.
          </ThemedText>
          <TextInput
            leftIcon="lock"
            placeholder="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={NEW_PASSWORD_RULES}
            editable={!busy}
            accessibilityLabel="New password"
            accessibilityHint={`At least ${PASSWORD_MIN_SINGLE_FACTOR} characters`}
          />
          <TextInput
            leftIcon="lock"
            placeholder="Confirm new password"
            value={confirmNewPassword}
            onChangeText={setConfirmNewPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={NEW_PASSWORD_RULES}
            editable={!busy}
            accessibilityLabel="Confirm new password"
          />
          <Button
            onPress={() => void onSetPassword()}
            disabled={!newPassword || !confirmNewPassword || expired}
            loading={busy}
          >
            Save and sign in
          </Button>
          <Button
            variant="outline"
            onPress={() => choose("choose")}
            disabled={busy}
          >
            Back
          </Button>
        </View>
      ) : null}

      <InlineError message={error} />
      {expired ? (
        <Button onPress={() => navigation.goBack()}>Back to sign in</Button>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.xl },
  section: { gap: Spacing.md },
});
