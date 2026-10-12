import React, { useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SecondFactorInput } from "@shared/types/auth";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { SecondFactorField } from "@/components/SecondFactorField";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Spacing, withOpacity } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { secondFactorErrorMessage } from "@/lib/second-factor-utils";
import {
  codeScreenIntro,
  showTrustSwitch,
  TRUST_LABEL,
} from "./TwoStepCodeScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "TwoStepCode">;

/**
 * The password was right on an account with two-step verification: enter the
 * code from the email we just sent to finish signing in, or to finish
 * connecting Google/Apple from the Connect prompt.
 */
export default function TwoStepCodeScreen({ route, navigation }: Props) {
  const { challenge, purpose, emailHint, codeSent } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { verifySecondFactor, finishSignIn, resendSignInCode } =
    useAuthContext();
  // On by default: a phone that passed the check once isn't asked again.
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // No try/finally: React Compiler cannot lower a `finally`.
  const submit = async (input: SecondFactorInput) => {
    if (busy) return;
    setBusy(true);
    setError("");
    // Outside the try: React Compiler can't lower a conditional inside one.
    const trustDevice = showTrustSwitch(purpose) && trust;
    try {
      const result = await verifySecondFactor(challenge, input, trustDevice);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Signed in");
      await finishSignIn(result.user, result.token);
    } catch (err) {
      setBusy(false);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      const outcome = secondFactorErrorMessage(err);
      if (outcome.restart) {
        toast.error(outcome.message, { haptic: false });
        navigation.popToTop();
        return;
      }
      setError(outcome.message);
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
          <ThemedText type="h2" accessibilityRole="header">
            Two-step verification
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {codeScreenIntro({ emailHint, codeSent })}
          </ThemedText>
        </View>

        <SecondFactorField
          onSubmit={submit}
          error={error}
          busy={busy}
          emailCode={{
            send: () => resendSignInCode(challenge),
            alreadySent: codeSent !== false,
          }}
        />

        {showTrustSwitch(purpose) ? (
          <View style={styles.trustRow}>
            <ThemedText type="body" style={styles.flex}>
              {TRUST_LABEL}
            </ThemedText>
            <Switch
              value={trust}
              onValueChange={(v) => {
                haptics.selection();
                setTrust(v);
              }}
              disabled={busy}
              accessibilityLabel={TRUST_LABEL}
              accessibilityHint="For 90 days, signing in with your password on this phone won't ask for a code"
              trackColor={{
                false: withOpacity(theme.textSecondary, 0.3),
                true: theme.link,
              }}
              thumbColor={
                Platform.OS === "android" ? theme.buttonText : undefined
              }
            />
          </View>
        ) : null}

        <Pressable
          onPress={() => navigation.popToTop()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Start again"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.restart}
        >
          <ThemedText type="small" style={{ color: theme.link }}>
            Start again
          </ThemedText>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.xl },
  header: { gap: Spacing.sm },
  trustRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  flex: { flex: 1 },
  restart: { alignSelf: "center", paddingVertical: Spacing.sm },
});
