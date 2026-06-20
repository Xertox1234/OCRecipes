import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  isValidEmailShape,
  verifyEmailRequest,
  resendVerificationRequest,
} from "./VerifyEmailScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "VerifyEmail">;

type Status = "confirming" | "confirmed" | "failed" | "pending";

export default function VerifyEmailScreen({ route, navigation }: Props) {
  const { theme } = useTheme();
  const tokenParam = route.params?.token;
  const [status, setStatus] = useState<Status>(
    tokenParam ? "confirming" : "pending",
  );
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A verification email was actually sent only when a caller explicitly says so
  // via the `sent` param (the register path) or after a successful resend. We do
  // NOT infer a send from the presence of `email` — that's a proxy, not a fact:
  // a future caller could route here with an email but no send and re-introduce
  // the misleading "we've sent a link" copy. The login → EMAIL_NOT_VERIFIED entry
  // omits `sent`, so the copy must NOT claim a send on that path.
  const [linkSent, setLinkSent] = useState(route.params?.sent ?? false);

  // Confirm flow: a deep link delivered a token → verify it on mount.
  useEffect(() => {
    if (!tokenParam) return;
    let cancelled = false;
    // void: the IIFE's promise is intentionally fire-and-forget (the cleanup
    // flag handles unmount); satisfies @typescript-eslint/no-floating-promises.
    void (async () => {
      try {
        await verifyEmailRequest(tokenParam);
        if (!cancelled) {
          setStatus("confirmed");
          // Async state transition → announce for screen readers (both
          // platforms; no live region present, so no double-announce risk).
          AccessibilityInfo.announceForAccessibility(
            "Your email is verified. You can now sign in.",
          );
        }
      } catch {
        if (!cancelled) {
          setStatus("failed");
          AccessibilityInfo.announceForAccessibility(
            "That verification link is invalid or expired.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenParam]);

  const onResend = async () => {
    setError("");
    if (!isValidEmailShape(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await resendVerificationRequest(email);
      setError("");
      setLinkSent(true);
      setStatus("pending");
      AccessibilityInfo.announceForAccessibility(
        "A new verification link has been sent.",
      );
    } catch {
      // Resend is always neutral server-side; only a network error lands here.
      setError("Couldn't resend right now. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        {status === "confirming" ? (
          <ThemedText type="h2">Verifying your email…</ThemedText>
        ) : status === "confirmed" ? (
          <>
            <ThemedText type="h2">Email verified ✓</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              You can now sign in.
            </ThemedText>
            <Button
              onPress={() => navigation.navigate("Login")}
              style={styles.button}
            >
              Back to sign in
            </Button>
          </>
        ) : status === "failed" ? (
          <>
            <ThemedText type="h2">Link expired or invalid</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Enter your email and we&apos;ll send a fresh link.
            </ThemedText>
            <TextInput
              leftIcon="mail"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-resend-email"
              error={!!error}
              errorMessage={error || undefined}
            />
            <InlineError message={error} />
            <Button onPress={onResend} loading={busy} style={styles.button}>
              Resend verification email
            </Button>
          </>
        ) : (
          <>
            <ThemedText type="h2">
              {linkSent ? "Check your inbox" : "Verify your email"}
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {linkSent
                ? `We've sent a verification link${email ? ` to ${email}` : ""}. Click it to finish setting up your account.`
                : "Your email isn't verified yet. Enter it below and we'll send you a verification link."}
            </ThemedText>
            <TextInput
              leftIcon="mail"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-resend-email"
              error={!!error}
              errorMessage={error || undefined}
            />
            <InlineError message={error} />
            <Button onPress={onResend} loading={busy} style={styles.button}>
              Resend email
            </Button>
          </>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.lg,
  },
  button: { marginTop: Spacing.sm },
});
