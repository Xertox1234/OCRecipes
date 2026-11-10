import React, { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { AI_RECIPIENTS, AI_SHARED_DATA } from "@shared/lib/ai-sharing";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/context/ToastContext";
import { useAiSharing } from "@/hooks/useAiSharing";
import { logger } from "@/lib/logger";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";

const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? "https://ocrecipes.com/privacy";

/**
 * The AI-sharing question (privacy audit H3): names the companies the AI
 * features send data to and what is sent, and asks before the first request.
 * Shown once after sign-in, and again when someone who said "off" opens an AI
 * feature. The server refuses AI requests until the answer is yes.
 */
export default function AiSharingScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const navigation = useNavigation();
  const { answer } = useAiSharing();
  const [saving, setSaving] = useState(false);

  // Promise handlers, not try/finally: React Compiler does not compile a
  // component whose callback has a `finally` block.
  const handleAnswer = (allowed: boolean) => {
    setSaving(true);
    answer(allowed).then(
      () => {
        setSaving(false);
        // The re-ask copy sits on top of the app and closes itself; the first
        // ask is the only screen, and the navigator moves on by itself.
        if (navigation.canGoBack()) navigation.goBack();
      },
      (err: unknown) => {
        setSaving(false);
        logger.error("Saving the AI-sharing answer failed", err);
        toast.error("Couldn't save your answer. Please try again.");
      },
    );
  };

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.container,
        { backgroundColor: theme.backgroundRoot, paddingTop: insets.top },
      ]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
      >
        <View style={styles.header}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: withOpacity(theme.success, 0.08) },
            ]}
          >
            <Feather name="cpu" size={36} color={theme.success} />
          </View>
          <ThemedText type="h3" style={styles.centered}>
            AI features and your data
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.centered, { color: theme.textSecondary }]}
          >
            Photo scanning, typed food logging, Coach and recipe ideas are run
            by AI companies outside OCRecipes. Before anything is sent, here is
            who they are and what they receive.
          </ThemedText>
        </View>

        <ThemedText
          type="body"
          accessibilityRole="header"
          style={styles.sectionTitle}
        >
          Who receives it
        </ThemedText>
        <View style={styles.list}>
          {AI_RECIPIENTS.map((recipient) => (
            <View
              key={recipient.name}
              style={[styles.row, { backgroundColor: theme.backgroundDefault }]}
            >
              <ThemedText type="body" style={styles.bold}>
                {recipient.name}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {recipient.role}
              </ThemedText>
            </View>
          ))}
        </View>

        <ThemedText
          type="body"
          accessibilityRole="header"
          style={styles.sectionTitle}
        >
          What is sent
        </ThemedText>
        <View style={styles.list}>
          {AI_SHARED_DATA.map((item) => (
            <ThemedText
              key={item}
              type="small"
              style={{ color: theme.textSecondary }}
            >
              • {item}
            </ThemedText>
          ))}
        </View>

        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          We don&apos;t attach your email or account ID to these requests, and
          we never sell your data or share it with advertisers. You can turn AI
          features off any time in Settings. Barcode scanning and saved recipes
          work either way.
        </ThemedText>

        <Pressable
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          accessibilityRole="link"
          accessibilityLabel="Read our Privacy Policy"
          accessibilityHint="Opens the Privacy Policy in your browser"
          hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
          style={styles.link}
        >
          <ThemedText type="body" style={[styles.bold, { color: theme.link }]}>
            Read our Privacy Policy
          </ThemedText>
        </Pressable>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}
      >
        <Button
          onPress={() => handleAnswer(true)}
          disabled={saving}
          accessibilityLabel="Allow AI features"
          accessibilityHint="Lets OCRecipes send your photos, messages and needed profile details to the AI companies listed"
        >
          Allow AI features
        </Button>
        <Pressable
          testID="ai-sharing-decline"
          onPress={() => handleAnswer(false)}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Keep AI features off"
          accessibilityHint="Nothing is sent to AI companies; you can turn AI features on later in Settings"
          style={styles.decline}
        >
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Keep AI off
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing["3xl"],
  },
  header: {
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  centered: { textAlign: "center" },
  bold: { fontWeight: "600" },
  sectionTitle: { fontWeight: "600", marginBottom: Spacing.sm },
  list: { gap: Spacing.sm, marginBottom: Spacing.xl },
  row: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    gap: 2,
  },
  link: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
    marginTop: Spacing.lg,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  decline: {
    alignSelf: "center",
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
});
