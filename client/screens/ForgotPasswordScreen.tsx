import React, { useState } from "react";
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
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  isValidResetEmail,
  requestResetCode,
  getResetRequestErrorMessage,
} from "./ForgotPasswordScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

/**
 * Step 1 of password reset: ask for the account email and request a code.
 * The server answers identically for real and unknown addresses, so success
 * always moves on to the code screen; only the pre-lookup 429 stays here.
 * Headerless with a ghost "Back to sign in", like VerifyEmailScreen, so the
 * logged-out screens read as one flow.
 */
export default function ForgotPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSend = async () => {
    if (busy) return;
    setError("");
    if (!isValidResetEmail(email)) {
      setError("Please enter a valid email address.");
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    // No try/finally: React Compiler cannot lower a `finally` and would skip
    // this component (scripts/check-react-compiler-bailouts.js), so `busy` is
    // reset on each path instead.
    try {
      await requestResetCode(email);
      setBusy(false);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(
        "If an account uses that email, we've sent a 6-digit code.",
      );
      // replace, not navigate: Back from the code screen returns to Login, not
      // to a screen that would send another code.
      navigation.replace("ResetPassword", { email: email.trim() });
    } catch (err) {
      setBusy(false);
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
            Reset your password
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Enter the email on your account. We&apos;ll send a 6-digit code to
            reset your password.
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            leftIcon="mail"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={onSend}
            editable={!busy}
            testID="input-forgot-email"
            accessibilityLabel="Email"
            accessibilityHint="Enter the email address on your account"
            error={!!error}
            errorMessage={error || undefined}
          />
          <InlineError message={error} />
          <Button
            onPress={onSend}
            loading={busy}
            loadingText="Sending code…"
            style={styles.button}
          >
            Send code
          </Button>
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
});
