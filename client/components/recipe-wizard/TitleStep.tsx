import React from "react";
import { Text, StyleSheet, ScrollView } from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { TITLE_MAX_LENGTH, DESCRIPTION_MAX_LENGTH } from "./title-step-utils";

interface TitleStepProps {
  title: string;
  setTitle: (t: string) => void;
  description: string;
  setDescription: (d: string) => void;
}

export default function TitleStep({
  title,
  setTitle,
  description,
  setDescription,
}: TitleStepProps) {
  const { theme } = useTheme();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Recipe Name */}
      <Text style={[styles.label, { color: theme.link }]}>RECIPE NAME</Text>
      <FocusTextInput
        style={[
          styles.input,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: withOpacity(theme.link, 0.25),
            color: theme.text,
          },
        ]}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Creamy Tomato Pasta"
        placeholderTextColor={theme.textSecondary}
        autoFocus
        returnKeyType="next"
        maxLength={TITLE_MAX_LENGTH}
        accessibilityLabel="Recipe name"
        accessibilityHint="Enter a name for your recipe"
      />

      {/* Description */}
      <Text
        style={[styles.label, { color: theme.link, marginTop: Spacing.lg }]}
      >
        DESCRIPTION (optional)
      </Text>
      <FocusTextInput
        style={[
          styles.textArea,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: withOpacity(theme.border, 0.5),
            color: theme.text,
          },
        ]}
        value={description}
        onChangeText={setDescription}
        placeholder="Briefly describe your recipe…"
        placeholderTextColor={theme.textSecondary}
        multiline
        textAlignVertical="top"
        maxLength={DESCRIPTION_MAX_LENGTH}
        accessibilityLabel="Recipe description"
        accessibilityHint="Optional description of your recipe"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.xl },
  label: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    fontFamily: FontFamily.regular,
    fontSize: 16,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    fontFamily: FontFamily.regular,
    fontSize: 15,
    minHeight: 120,
  },
});
