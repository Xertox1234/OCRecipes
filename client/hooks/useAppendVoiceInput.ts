import { useCallback, useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";

import { useVoiceField } from "@/hooks/useVoiceField";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";

interface UseAppendVoiceInputOptions {
  /** The field's current text. */
  text: string;
  setText: (next: string) => void;
  /** The field's length cap; the base plus the dictation is cut to it. */
  maxLength: number;
  /** Ends any capture when it turns true (e.g. a reply starts streaming). */
  stopWhen?: boolean;
}

/**
 * The mic button of a composer: dictation APPENDS to whatever was typed when
 * the mic was tapped and never sends — the user reviews it and sends
 * themselves. `useVoiceField` decides whether a transcript may be written at
 * all; a speech error shows as a toast.
 */
export function useAppendVoiceInput({
  text,
  setText,
  maxLength,
  stopWhen = false,
}: UseAppendVoiceInputOptions) {
  const haptics = useHaptics();
  const toast = useToast();
  // What was typed when the mic was tapped.
  const baseRef = useRef("");
  const { isListening, volume, error, toggle, release } = useVoiceField({
    onTranscript: (transcript) => {
      const base = baseRef.current;
      setText(
        (base ? `${base} ${transcript}` : transcript).slice(0, maxLength),
      );
    },
  });

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  useEffect(() => {
    if (stopWhen) release();
  }, [stopWhen, release]);

  const onPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (!isListening) baseRef.current = text.trim();
    toggle();
  }, [haptics, isListening, text, toggle]);

  return { isListening, volume, onPress, release };
}
