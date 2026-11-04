import { useCallback, useEffect, useRef } from "react";

import { useSpeechToText } from "@/hooks/useSpeechToText";

interface UseVoiceFieldOptions {
  /** Receives the dictated words; the caller decides how to write them. */
  onTranscript: (transcript: string) => void;
  /**
   * False while the field is hidden or out of use (closed drawer, another
   * wizard step). Turning it false stops a session this field started.
   */
  enabled?: boolean;
}

/**
 * Speech-to-text for ONE text field. Every mounted instance of
 * `useSpeechToText` sees the one shared recognizer, so the field keeps an
 * ownership flag: the transcript is written only while this field started
 * the session. The flag is cleared whenever the session ends (final result,
 * silence timeout, error, cancel), so a late transcript can never land in a
 * field that has moved on.
 */
export function useVoiceField({
  onTranscript,
  enabled = true,
}: UseVoiceFieldOptions) {
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error,
    startListening,
    stopListening,
  } = useSpeechToText();

  const ownsSessionRef = useRef(false);
  const wasListeningRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  // Write first, then (next effect) clear ownership: a final result can land
  // in the same render as the "end" event and must still be written.
  useEffect(() => {
    if (
      enabled &&
      ownsSessionRef.current &&
      transcript &&
      (isListening || isFinal)
    ) {
      onTranscriptRef.current(transcript);
    }
  }, [enabled, isListening, isFinal, transcript]);

  // The session is over once it has listened and stopped, or errored.
  useEffect(() => {
    if (isListening) {
      wasListeningRef.current = true;
      return;
    }
    if (wasListeningRef.current || error) {
      wasListeningRef.current = false;
      ownsSessionRef.current = false;
    }
  }, [isListening, error]);

  // Hidden or out-of-use field: end the session it started, never another's.
  useEffect(() => {
    if (!enabled && ownsSessionRef.current) {
      ownsSessionRef.current = false;
      if (isListening) stopListening();
    }
  }, [enabled, isListening, stopListening]);

  /** The mic button: stop when listening, otherwise start and take ownership. */
  const toggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      ownsSessionRef.current = true;
      void startListening();
    }
  }, [isListening, startListening, stopListening]);

  /** Submit/clear/close: end this field's session and stop any late write. */
  const release = useCallback(() => {
    const owned = ownsSessionRef.current;
    ownsSessionRef.current = false;
    if (owned && isListening) stopListening();
  }, [isListening, stopListening]);

  return { isListening, volume, error, toggle, release };
}
