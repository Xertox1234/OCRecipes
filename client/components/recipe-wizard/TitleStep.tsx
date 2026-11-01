import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  ScrollView,
  View,
  type TextInputInstance,
} from "react-native";
import * as Haptics from "expo-haptics";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FieldCounter } from "@/components/FieldCounter";
import { InlineMicButton } from "@/components/InlineMicButton";
import { InlineError } from "@/components/InlineError";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useHaptics } from "@/hooks/useHaptics";
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
  const [focusedField, setFocusedField] = useState<
    "title" | "description" | null
  >(null);
  const descriptionRef = useRef<TextInputInstance>(null);
  const haptics = useHaptics();

  // Voice input REPLACES the title with the dictated words.
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  // false once the title is submitted, so a late final result cannot refill.
  const voiceActiveRef = useRef(false);
  useEffect(() => {
    if (voiceActiveRef.current && transcript && (isListening || isFinal)) {
      setTitle(transcript.slice(0, TITLE_MAX_LENGTH));
    }
  }, [isListening, isFinal, transcript, setTitle]);
  const handleVoicePress = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      voiceActiveRef.current = true;
      void startListening();
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <FocusTextInput
        label="Recipe title"
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
        // Keep the keyboard up while focus moves on to the description.
        submitBehavior="submit"
        onSubmitEditing={() => {
          voiceActiveRef.current = false;
          if (isListening) stopListening();
          descriptionRef.current?.focus();
        }}
        maxLength={TITLE_MAX_LENGTH}
        onFocus={() => setFocusedField("title")}
        onBlur={() => setFocusedField(null)}
        accessibilityHint="Enter a name for your recipe"
      />
      <FieldCounter
        length={title.length}
        max={TITLE_MAX_LENGTH}
        visible={focusedField === "title"}
      />
      <View style={styles.micRow}>
        <InlineMicButton
          isListening={isListening}
          volume={volume}
          onPress={handleVoicePress}
        />
      </View>
      <InlineError message={speechError} />

      <FocusTextInput
        ref={descriptionRef}
        label="Description"
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
        placeholder="Optional · e.g. a weeknight family favourite"
        placeholderTextColor={theme.textSecondary}
        multiline
        textAlignVertical="top"
        maxLength={DESCRIPTION_MAX_LENGTH}
        onFocus={() => setFocusedField("description")}
        onBlur={() => setFocusedField(null)}
        accessibilityHint="Optional description of your recipe"
      />
      <FieldCounter
        length={description.length}
        max={DESCRIPTION_MAX_LENGTH}
        visible={focusedField === "description"}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.xl },
  micRow: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    marginTop: Spacing.sm,
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
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    fontFamily: FontFamily.regular,
    fontSize: 15,
    minHeight: 120,
  },
});
