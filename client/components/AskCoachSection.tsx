import React from "react";
import { StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import {
  useCoachOverlay,
  type CoachQuestion,
} from "@/context/CoachOverlayContext";
import { Spacing, FontFamily } from "@/constants/theme";

interface AskCoachSectionProps {
  questions: readonly CoachQuestion[];
  screenContext: string;
}

export const AskCoachSection = React.memo(function AskCoachSection({
  questions,
  screenContext,
}: AskCoachSectionProps) {
  const { theme } = useTheme();
  const { openCoach } = useCoachOverlay();

  return (
    <Card elevation={1} style={styles.card}>
      <ThemedText
        type="h4"
        style={styles.sectionTitle}
        accessibilityRole="header"
      >
        Ask Coach
      </ThemedText>
      {questions.map((q) => (
        <Pressable
          key={q.text}
          onPress={() => openCoach(q, screenContext)}
          style={({ pressed }) => [
            styles.questionRow,
            {
              borderBottomColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={q.text}
          accessibilityHint="Opens coach overlay with answer to this question"
        >
          <Ionicons
            name="chatbubble-outline"
            size={16}
            color={theme.link}
            importantForAccessibility="no"
          />
          <ThemedText
            style={[styles.questionText, { color: theme.text }]}
            numberOfLines={1}
          >
            {q.text}
          </ThemedText>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.textSecondary}
            importantForAccessibility="no"
          />
        </Pressable>
      ))}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    minHeight: 44,
    borderBottomWidth: 1,
  },
  questionText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
});
