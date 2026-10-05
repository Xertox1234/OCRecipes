import React, { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";
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
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { BorderRadius, Spacing } from "@/constants/theme";
import { NATIVE_PROVIDERS } from "@/lib/social-sign-in";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  connectErrorOutcome,
  connectPromptMode,
} from "./ConnectAccountScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "ConnectAccount">;

/**
 * A Google/Apple sign-in whose email already belongs to an OCRecipes account
 * that we can't safely link automatically. The person proves they own that
 * account (password, or a provider it already uses) and the new sign-in is
 * connected. "Forgot password?" is always offered.
 */
export default function ConnectAccountScreen({ route, navigation }: Props) {
  const { ticket, methods, email } = route.params;
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { linkWithPassword, linkWithProvider } = useAuthContext();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mode = connectPromptMode(
    methods,
    Platform.OS as "ios" | "android" | "web",
    NATIVE_PROVIDERS,
  );

  const fail = (err: unknown) => {
    setBusy(false);
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    const outcome = connectErrorOutcome(err);
    if (outcome.kind === "restart") {
      toast.error("That took too long — please start again.");
      navigation.navigate("Login");
      return;
    }
    setError(outcome.message);
  };

  // No try/finally in either handler: React Compiler cannot lower a `finally`.
  const onPassword = async () => {
    if (busy) return;
    setError("");
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setBusy(true);
    try {
      await linkWithPassword(ticket, password);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      fail(err);
    }
  };

  const onProvider = async () => {
    if (busy || mode.kind !== "provider") return;
    setError("");
    setBusy(true);
    try {
      await linkWithProvider(ticket, mode.provider);
      // A cancelled sheet resolves without signing in: re-enable the button.
      setBusy(false);
    } catch (err) {
      fail(err);
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
            Connect your account
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            You already have an OCRecipes account with {email}.{" "}
            {mode.kind === "password"
              ? "Enter its password to connect this sign-in."
              : mode.kind === "provider"
                ? "Sign in the way you usually do to connect it."
                : "Reset its password to sign in, then connect from Settings."}
          </ThemedText>
        </View>

        <View style={styles.form}>
          {mode.kind === "password" ? (
            <>
              <TextInput
                leftIcon="lock"
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={onPassword}
                editable={!busy}
                testID="input-connect-password"
                accessibilityLabel="Password"
                error={!!error}
                errorMessage={error || undefined}
              />
              <InlineError message={error} />
              <Button
                onPress={onPassword}
                loading={busy}
                loadingText="Connecting…"
                style={styles.button}
              >
                Connect and sign in
              </Button>
            </>
          ) : null}

          {mode.kind === "provider" && mode.provider === "apple" ? (
            <>
              <View style={busy ? styles.busy : undefined}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={
                    AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                  }
                  buttonStyle={
                    isDark
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={BorderRadius.sm}
                  style={styles.appleButton}
                  onPress={onProvider}
                />
              </View>
              <InlineError message={error} />
            </>
          ) : null}

          <Button
            variant="ghost"
            onPress={() => navigation.navigate("ForgotPassword", { email })}
            style={styles.button}
          >
            Forgot password?
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
  appleButton: { height: 48, width: "100%" },
  busy: { opacity: 0.5 },
  button: { marginTop: Spacing.sm },
});
