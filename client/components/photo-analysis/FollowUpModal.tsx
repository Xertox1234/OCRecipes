import React, { useState } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

import { FocusTextInput } from "@/components/FocusTextInput";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

export function FollowUpModal({
  questions,
  currentIndex,
  onAnswer,
  onSkip,
}: {
  questions: string[];
  currentIndex: number;
  onAnswer: (question: string, answer: string) => void;
  onSkip: () => void;
}) {
  const { theme } = useTheme();
  const [answer, setAnswer] = useState("");

  const currentQuestion = questions[currentIndex];

  const handleSubmit = () => {
    if (answer.trim()) {
      onAnswer(currentQuestion, answer.trim());
      setAnswer("");
    }
  };

  return (
    <View
      style={[
        styles.followUpModal,
        { backgroundColor: theme.backgroundDefault },
      ]}
      accessibilityViewIsModal={true}
    >
      <View style={styles.followUpHeader}>
        <Feather name="help-circle" size={24} color={theme.info} />
        <ThemedText type="h4" style={styles.followUpTitle}>
          Quick Question
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {currentIndex + 1} of {questions.length}
        </ThemedText>
      </View>

      <ThemedText type="body" style={styles.followUpQuestion}>
        {currentQuestion}
      </ThemedText>

      <FocusTextInput
        style={[
          styles.followUpInput,
          { backgroundColor: theme.backgroundSecondary, color: theme.text },
        ]}
        value={answer}
        onChangeText={setAnswer}
        placeholder="Type your answer..."
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Follow-up question about food"
        multiline
        returnKeyType="done"
        // Return submits (as QuickLogScreen does) instead of a line break.
        submitBehavior="blurAndSubmit"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.followUpButtons}>
        <Pressable
          onPress={onSkip}
          accessibilityLabel="Skip question"
          accessibilityRole="button"
          style={[
            styles.skipButton,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <ThemedText type="body">Skip</ThemedText>
        </Pressable>
        <Button
          onPress={handleSubmit}
          disabled={!answer.trim()}
          style={{ flex: 1, backgroundColor: theme.success }}
        >
          Continue
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  followUpModal: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.xl,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    shadowColor: "#000", // hardcoded — shadow color is always black
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  followUpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  followUpTitle: {
    flex: 1,
  },
  followUpQuestion: {
    marginBottom: Spacing.lg,
  },
  followUpInput: {
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: Spacing.lg,
  },
  followUpButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  skipButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
});
