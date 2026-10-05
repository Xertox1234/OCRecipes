import React from "react";
import { Linking, StyleSheet } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/legal";
import { useTheme } from "@/hooks/useTheme";

interface LegalConsentCaptionProps {
  /** Called when a link cannot be opened; the screen shows its own error. */
  onLinkError: () => void;
}

/**
 * "By continuing, you agree to…" under every account-creating form —
 * password sign-up and the Google/Apple ChooseUsername screen.
 */
export function LegalConsentCaption({ onLinkError }: LegalConsentCaptionProps) {
  const { theme } = useTheme();

  const open = (url: string) => {
    Linking.openURL(url).catch(onLinkError);
  };

  return (
    <ThemedText
      type="caption"
      style={[styles.text, { color: theme.textSecondary }]}
    >
      By continuing, you agree to our{" "}
      <ThemedText
        type="caption"
        style={[styles.link, { color: theme.link }]}
        accessibilityRole="link"
        accessibilityLabel="Terms of Service"
        onPress={() => open(TERMS_URL)}
      >
        Terms of Service
      </ThemedText>{" "}
      and{" "}
      <ThemedText
        type="caption"
        style={[styles.link, { color: theme.link }]}
        accessibilityRole="link"
        accessibilityLabel="Privacy Policy"
        onPress={() => open(PRIVACY_POLICY_URL)}
      >
        Privacy Policy
      </ThemedText>
      .
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  text: {
    lineHeight: 18,
  },
  link: {
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
