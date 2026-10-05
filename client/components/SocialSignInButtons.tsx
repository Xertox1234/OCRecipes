import React, { useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useAuthContext } from "@/context/AuthContext";
import { useHaptics } from "@/hooks/useHaptics";
import { useSocialConfig } from "@/hooks/useSocialConfig";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  socialSignInErrorMessage,
  visibleProviders,
} from "@/lib/social-auth-utils";
import { NATIVE_PROVIDERS } from "@/lib/social-sign-in";
import type { SocialProvider, SocialSignInResult } from "@shared/types/auth";

interface Props {
  /** Called for every completed attempt; `signed_in` needs no action (the root navigator switches stacks). */
  onResult: (result: SocialSignInResult) => void;
  /** Static, user-facing copy for a failed attempt. */
  onError: (message: string) => void;
}

/**
 * "Continue with Apple" (Google joins once its SDK ships) above the password
 * form, followed by an "or" divider. Renders nothing when no provider is both
 * configured on the server and available on this platform.
 */
export function SocialSignInButtons({ onResult, onError }: Props) {
  const config = useSocialConfig();
  const { signInWithProvider } = useAuthContext();
  const { theme, isDark } = useTheme();
  const haptics = useHaptics();
  // A ref, not just state: two taps in the same frame must not open two sheets.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const providers = visibleProviders(
    {
      apple: config.apple && NATIVE_PROVIDERS.apple,
      google: config.google && NATIVE_PROVIDERS.google,
    },
    Platform.OS as "ios" | "android" | "web",
  );
  if (providers.length === 0) return null;

  const run = async (provider: SocialProvider) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    const done = () => {
      inFlight.current = false;
      setBusy(false);
    };
    // No try/finally: React Compiler cannot lower a `finally` and would skip
    // this component (scripts/check-react-compiler-bailouts.js).
    try {
      const result = await signInWithProvider(provider);
      done();
      // null = the person cancelled the sheet: show nothing.
      if (result) onResult(result);
    } catch (err) {
      done();
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      onError(socialSignInErrorMessage(err));
    }
  };

  return (
    <View style={styles.container}>
      {providers.includes("apple") && (
        <View style={busy ? styles.busy : undefined}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            buttonStyle={
              isDark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={BorderRadius.sm}
            style={styles.appleButton}
            onPress={() => run("apple")}
          />
        </View>
      )}
      <View style={styles.divider} accessible={false}>
        <View
          style={[styles.rule, { backgroundColor: theme.border }]}
          importantForAccessibility="no"
        />
        <ThemedText
          type="caption"
          style={[styles.or, { color: theme.textSecondary }]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          or
        </ThemedText>
        <View
          style={[styles.rule, { backgroundColor: theme.border }]}
          importantForAccessibility="no"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.lg, marginBottom: Spacing.lg },
  appleButton: { height: 48, width: "100%" },
  busy: { opacity: 0.5 },
  divider: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  or: { textTransform: "uppercase" },
});
