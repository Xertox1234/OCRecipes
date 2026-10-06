import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { LegalConsentCaption } from "@/components/LegalConsentCaption";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { validateUsername } from "./LoginScreen-utils";
import { chooseUsernameErrorOutcome } from "./ConnectAccountScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "ChooseUsername">;

/**
 * First Google/Apple sign-in for an email no account uses yet: pick a
 * username (prefilled, editable) and confirm age, then the account is created
 * and signed in — the root navigator moves to onboarding on its own.
 */
export default function ChooseUsernameScreen({ route, navigation }: Props) {
  const { ticket, suggestedUsername } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { completeSocialSignUp } = useAuthContext();
  const [username, setUsername] = useState(suggestedUsername);
  // COPPA 13+ attestation — the person's own checkbox; server enforces true.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (busy || !ageConfirmed) return;
    setError("");
    const trimmed = username.trim();
    const invalid = validateUsername(trimmed);
    if (invalid) {
      setError(invalid);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    // No try/finally: React Compiler cannot lower a `finally`.
    try {
      await completeSocialSignUp(ticket, trimmed, ageConfirmed);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setBusy(false);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      const outcome = chooseUsernameErrorOutcome(err);
      if (outcome.kind === "restart") {
        // Error haptic already fired above for every branch.
        toast.error(outcome.message, { haptic: false });
        navigation.navigate("Login");
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
          <ThemedText type="h2" style={styles.title}>
            Choose a username
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            This is how you&apos;ll appear in OCRecipes. You can use letters,
            numbers, and underscores.
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            leftIcon="user"
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            autoComplete="username"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
            editable={!busy}
            testID="input-choose-username"
            accessibilityLabel="Username"
            error={!!error}
            errorMessage={error || undefined}
          />
          <InlineError message={error} />

          <Pressable
            onPress={() => {
              haptics.selection();
              setAgeConfirmed((prev) => !prev);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ageConfirmed }}
            accessibilityLabel="I confirm I am 13 years of age or older"
            hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
            testID="checkbox-age-confirm"
            style={styles.ageRow}
          >
            <Feather
              name={ageConfirmed ? "check-square" : "square"}
              size={22}
              color={ageConfirmed ? theme.success : theme.textSecondary}
            />
            <ThemedText type="body" style={styles.ageLabel}>
              I confirm I am 13 years of age or older
            </ThemedText>
          </Pressable>
          <LegalConsentCaption
            onLinkError={() =>
              setError("Unable to open that link. Please try again later.")
            }
          />

          <Button
            onPress={onSubmit}
            loading={busy}
            loadingText="Creating your account…"
            disabled={!ageConfirmed}
            style={styles.button}
          >
            Continue
          </Button>
          {/* A relay or unmatched email never auto-links (server policy), so
              an existing user would otherwise make a second account here. */}
          <ThemedText
            type="small"
            style={[styles.hint, { color: theme.textSecondary }]}
          >
            Already have an OCRecipes account? Sign in with your password
            instead, then add this sign-in under Settings → Sign-in methods.
          </ThemedText>
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
  ageRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  ageLabel: { flexShrink: 1 },
  button: { marginTop: Spacing.sm },
  hint: { marginTop: Spacing.lg },
});
