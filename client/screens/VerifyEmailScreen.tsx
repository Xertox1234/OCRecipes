import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import { useAuthContext } from "@/context/AuthContext";
import { safeGoBack } from "@/navigation/safeGoBack";
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
  const haptics = useHaptics();
  // Signed in = a verify link tapped from inside the app — the change-email flow
  // mails one to the new address while the session stays live. That stack has
  // no Login route, so every exit is Done back into the app instead.
  const { isAuthenticated, checkAuth } = useAuthContext();
  const tokenParam = route.params?.token;
  const [status, setStatus] = useState<Status>(
    tokenParam ? "confirming" : "pending",
  );
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
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
            isAuthenticated
              ? "That email address is verified."
              : "Your email is verified. You can now sign in.",
          );
          // A confirmed change-email link swaps the account's address
          // server-side — refetch so Settings shows the new one.
          if (isAuthenticated) void checkAuth();
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
    // checkAuth is a stable useCallback, and an auth flip removes this screen
    // (navigationKey in RootStackNavigator), so this still runs once per token.
  }, [tokenParam, isAuthenticated, checkAuth]);

  const onResend = async () => {
    setError("");
    if (!isValidEmailShape(email)) {
      setError("Please enter a valid email address.");
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
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
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  // Signed in, the screen is a modal over the app; a cold-start link leaves it
  // alone in the stack, so goBack would be a silent no-op without the fallback.
  const exit = () =>
    isAuthenticated
      ? safeGoBack(navigation, () =>
          navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
        )
      : navigation.navigate("Login");
  const exitLabel = isAuthenticated ? "Done" : "Back to sign in";

  return (
    <ThemedView style={styles.container} accessibilityViewIsModal={true}>
      <View style={styles.content}>
        {status === "confirming" ? (
          <>
            <ThemedText type="h2">Verifying your email…</ThemedText>
            <Button variant="ghost" onPress={exit} style={styles.button}>
              {exitLabel}
            </Button>
          </>
        ) : status === "confirmed" ? (
          <>
            <ThemedText type="h2">Email verified ✓</ThemedText>
            {/* The token names its own user, so signed in the screen can't tell
                whose address it confirmed — never claim "your". */}
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {isAuthenticated
                ? "That email address is confirmed."
                : "You can now sign in."}
            </ThemedText>
            <Button onPress={exit} style={styles.button}>
              {exitLabel}
            </Button>
          </>
        ) : isAuthenticated ? (
          // Failed, or no token at all ("pending" — a hand-made or broken
          // link): signed in, both are just an invalid link.
          <>
            <ThemedText type="h2">Link expired or invalid</ThemedText>
            {/* No resend here: it looks up the verified email only, so it can
                never re-send a pending change-email link. */}
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              To get a new link, change your email again in Settings.
            </ThemedText>
            <Button onPress={exit} style={styles.button}>
              Done
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
              accessibilityLabel="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-resend-email"
              error={!!error}
              errorMessage={error || undefined}
            />
            <InlineError message={error} shakeKey={shakeKey} />
            <Button onPress={onResend} loading={busy} style={styles.button}>
              Resend verification email
            </Button>
            <Button variant="ghost" onPress={exit} style={styles.button}>
              Back to sign in
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
              accessibilityLabel="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-resend-email"
              error={!!error}
              errorMessage={error || undefined}
            />
            <InlineError message={error} shakeKey={shakeKey} />
            {/* Prominence follows intent within the pending state. In the
                not-sent sub-state ("Verify your email") resending is the primary
                action, so Resend is the solid primary and Back-to-sign-in is the
                ghost escape hatch. Once linkSent flips ("Check your inbox") the
                user has already sent the link and may have just verified in the
                browser, so returning to Login is the likely intent — the two
                variants swap. Both variants are already on this screen and
                contrast-verified, so the swap adds no new color combination. */}
            <Button
              variant={linkSent ? "ghost" : "primary"}
              onPress={onResend}
              loading={busy}
              style={styles.button}
            >
              Resend email
            </Button>
            {/* Escape hatch for the verify-in-browser → return-to-app flow: the
                user lands here after signup and (if they verified elsewhere) has
                no other path to Login. Pure navigation — never auto-authenticates. */}
            <Button
              variant={linkSent ? "primary" : "ghost"}
              onPress={() => navigation.navigate("Login")}
              style={styles.button}
            >
              Back to sign in
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
