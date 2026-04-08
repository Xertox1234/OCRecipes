import React, { useCallback, useState } from "react";
import { StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, FontFamily } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { CoachQuestion } from "@/components/CoachOverlayContent";

interface AskCoachSectionProps {
  questions: readonly CoachQuestion[];
  screenContext: string;
  /** Override press handler for specific questions. Return true if handled. */
  onCustomPress?: (q: CoachQuestion) => boolean;
}

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export const AskCoachSection = React.memo(function AskCoachSection({
  questions,
  screenContext,
  onCustomPress,
}: AskCoachSectionProps) {
  const { theme } = useTheme();
  const { isPremium } = usePremiumContext();
  const navigation = useNavigation<NavProp>();
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handlePress = useCallback(
    (q: CoachQuestion) => {
      if (!isPremium) {
        setShowUpgrade(true);
        return;
      }
      // Allow parent to intercept specific questions (e.g., remix)
      if (onCustomPress?.(q)) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("CoachChat", {
        question: q.question,
        questionText: q.text,
        screenContext,
      });
    },
    [isPremium, navigation, screenContext, onCustomPress],
  );

  return (
    <>
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
            onPress={() => handlePress(q)}
            style={({ pressed }) => [
              styles.questionRow,
              {
                borderBottomColor: theme.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={q.text}
            accessibilityHint="Opens coach chat with answer to this question"
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
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </>
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
