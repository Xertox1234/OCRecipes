// client/components/home/GenerateRecipeDrawer.tsx
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { InlineMicButton } from "@/components/InlineMicButton";
import { InlineError } from "@/components/InlineError";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import {
  resolvePlaceholder,
  shouldFloatLabel,
} from "@/components/text-input-utils";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { GENERATE_IDEA_CHIPS } from "@/components/home/trending-fallback";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const PROMPT_LABEL = "Recipe idea";

interface GenerateRecipeDrawerProps {
  onUsed: () => void;
}

export function GenerateRecipeDrawer({ onUsed }: GenerateRecipeDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const [text, setText] = useState("");
  const promptFocus = useFieldFocus();

  // Voice input REPLACES the field with the dictated words.
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  // false once submitted/closed, so a late final result cannot refill.
  const voiceActiveRef = useRef(false);
  useEffect(() => {
    if (voiceActiveRef.current && transcript && (isListening || isFinal)) {
      setText(transcript);
    }
  }, [isListening, isFinal, transcript]);
  const handleVoicePress = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      voiceActiveRef.current = true;
      void startListening();
    }
  };

  const generate = (prompt: string) => {
    const p = prompt.trim();
    if (!p) return;
    haptics.selection();
    voiceActiveRef.current = false;
    if (isListening) stopListening();
    onUsed();
    navigation.navigate("RecipeChat", { initialMessage: p });
  };

  return (
    <View style={styles.container}>
      <FocusField
        focus={promptFocus}
        label={PROMPT_LABEL}
        hasValue={text.length > 0}
        style={[
          styles.inputRow,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
          },
        ]}
      >
        <FocusTextInput
          focusRing={false}
          onFocus={promptFocus.onFocus}
          onBlur={promptFocus.onBlur}
          style={[styles.input, { color: theme.text }]}
          // The label rests where the placeholder would; it shows once floated.
          placeholder={resolvePlaceholder(
            PROMPT_LABEL,
            "e.g. a quick weeknight curry",
            shouldFloatLabel(promptFocus.focused, text),
          )}
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => generate(text)}
          returnKeyType="go"
          accessibilityLabel={PROMPT_LABEL}
        />
        <InlineMicButton
          isListening={isListening}
          volume={volume}
          onPress={handleVoicePress}
        />
        <Pressable
          onPress={() => generate(text)}
          accessibilityRole="button"
          accessibilityLabel="Generate recipe"
          hitSlop={8}
          style={({ pressed }) => [
            styles.goButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather
            name="arrow-right"
            size={20}
            color={theme.link}
            accessible={false}
          />
        </Pressable>
      </FocusField>
      <InlineError message={speechError} />

      <View style={styles.chipsWrap}>
        {GENERATE_IDEA_CHIPS.map((idea) => (
          <Pressable
            key={idea}
            onPress={() => generate(idea)}
            accessibilityRole="button"
            accessibilityLabel={`Generate: ${idea}`}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: withOpacity(theme.link, 0.08),
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ThemedText
              style={[styles.chipText, { color: theme.link }]}
              numberOfLines={1}
            >
              {idea}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  // Labelled field: the value sits under the floated label's row.
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.regular,
    ...LABELLED_INPUT_TEXT,
  },
  goButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: FontFamily.medium },
});
