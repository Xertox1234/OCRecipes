import React, { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { BorderRadius, Spacing } from "@/constants/theme";

interface ReplacementCodeCardProps {
  /** The new recovery code that replaced the one just used. */
  code: string;
  /** "I've saved it" — the caller continues (signs in, closes the modal…). */
  onDone: () => void;
  busy?: boolean;
}

/**
 * A recovery code was just used up; the server issued a new one. It's shown
 * once, so the person must save it before moving on.
 */
export function ReplacementCodeCard({
  code,
  onDone,
  busy = false,
}: ReplacementCodeCardProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      `Your recovery code was used. Here's a new one: ${code}. Save it now.`,
    );
  }, [code]);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    toast.success("Copied");
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
        },
      ]}
    >
      <ThemedText type="body">
        Your recovery code was used. Here&apos;s a new one — save it now.
      </ThemedText>
      <ThemedText
        type="h4"
        selectable
        style={styles.code}
        testID="replacement-code"
      >
        {code}
      </ThemedText>
      <View style={styles.row}>
        <Button variant="outline" onPress={copy} style={styles.flex}>
          Copy
        </Button>
        <Button onPress={onDone} loading={busy} style={styles.flex}>
          I&apos;ve saved it
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  code: { letterSpacing: 1, textAlign: "center" },
  row: { flexDirection: "row", gap: Spacing.md },
  flex: { flex: 1 },
});
