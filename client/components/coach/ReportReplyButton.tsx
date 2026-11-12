import React, { useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NotificationFeedbackType } from "expo-haptics";
import Animated, { FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { PressableScale } from "@/components/PressableScale";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useReportChatMessage } from "@/hooks/useReportChatMessage";
import { chatReplyTextFadeMs } from "@/constants/animations";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import {
  CHAT_MESSAGE_REPORT_REASONS,
  type ChatMessageReportReason,
} from "@shared/constants/chat-message-report";

const DONE_TEXT = "Reported. Thank you.";

/**
 * The report control under a saved AI reply (privacy audit 2026-11-10, G7 —
 * Google Play asks that AI-generated content can be reported without leaving
 * the app). A small flag; tapping it opens the reasons in place, so it works
 * the same in the Coach tab, a chat screen and the coach sheet with no sheet
 * of its own. A report sends the reply's id and the reason, never the text.
 *
 * "Reported" is remembered only while this row stays mounted. A repeat report
 * is harmless: the server keeps the first.
 */
export default function ReportReplyButton({
  messageId,
}: {
  messageId: number;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { mutateAsync } = useReportChatMessage();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read synchronously: two fast taps land before `sending` re-renders.
  const isSending = useRef(false);

  const entering = reducedMotion
    ? undefined
    : FadeIn.duration(chatReplyTextFadeMs);

  const send = async (reason: ChatMessageReportReason) => {
    if (isSending.current) return;
    isSending.current = true;
    setSending(true);
    setError(null);
    haptics.selection();
    // No try/finally: it would opt this component out of React Compiler.
    const sent = await mutateAsync({ messageId, reason }).then(
      () => true,
      () => false,
    );
    isSending.current = false;
    setSending(false);
    if (sent) {
      setDone(true);
      haptics.notification(NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(DONE_TEXT);
    } else {
      // InlineError announces itself.
      setError("Couldn't send the report. Please try again.");
      haptics.notification(NotificationFeedbackType.Error);
    }
  };

  if (done) {
    return (
      <Animated.View entering={entering} style={[styles.wrap, styles.doneRow]}>
        <Ionicons name="flag" size={14} color={theme.textSecondary} />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {DONE_TEXT}
        </ThemedText>
      </Animated.View>
    );
  }

  if (!open) {
    return (
      <View style={styles.wrap}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.flag, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Report this reply"
        >
          <Ionicons name="flag-outline" size={14} color={theme.textSecondary} />
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.View entering={entering} style={[styles.wrap, styles.menu]}>
      <ThemedText type="small" style={{ color: theme.text }}>
        What is wrong with this reply?
      </ThemedText>
      <View style={styles.reasons}>
        {CHAT_MESSAGE_REPORT_REASONS.map((r) => (
          <PressableScale
            key={r.id}
            onPress={() => void send(r.id)}
            disabled={sending}
            style={[
              styles.reason,
              {
                borderColor: withOpacity(theme.link, 0.4),
                backgroundColor: withOpacity(theme.link, 0.08),
                opacity: sending ? 0.5 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityState={{ disabled: sending }}
          >
            <ThemedText type="small" style={{ color: theme.link }}>
              {r.label}
            </ThemedText>
          </PressableScale>
        ))}
        <Pressable
          onPress={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={sending}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Cancel
          </ThemedText>
        </Pressable>
      </View>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        We save which reply and your reason, not the text. Our Privacy Officer
        may read this reply to check it.
      </ThemedText>
      <InlineError message={error} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Lines up with the reply text: the row's side padding plus the avatar dot
  // (22) and its gap (9), as MemoryRefsTag does.
  wrap: {
    paddingLeft: Spacing.lg + 31,
    paddingRight: Spacing.lg,
    marginTop: -Spacing.xs,
  },
  // A real 44pt box, not hitSlop (Android clips hitSlop to the parent).
  flag: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  pressed: { opacity: 0.6 },
  doneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 44,
  },
  menu: {
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  reasons: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
  },
  reason: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  cancel: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
});
