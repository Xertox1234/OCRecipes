import { useState, useCallback, useRef, useEffect } from "react";
import * as Speech from "expo-speech";

import { useToast } from "@/context/ToastContext";
import { IMAGE_REGEX } from "@/components/markdown-text-utils";

/**
 * Split text into sentences on `.`, `!`, `?` followed by whitespace or end-of-string.
 * Returns only non-empty prose sentences. Blocks (ActionCards, code fences, etc.)
 * are excluded by the caller before passing text here.
 */
export function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter(Boolean);
}

/**
 * Strip markdown syntax so TTS reads clean prose.
 * Removes: bold/italic markers, inline code, headings, links, list markers.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(IMAGE_REGEX, "") // images first, or the link rule reads "!alt"
    .replace(/ {2,}/g, " ")
    .replace(/#{1,6}\s*/g, "") // headings
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+\.\s+/gm, "") // numbered lists
    .trim();
}

/**
 * Strip coach_blocks fences from text so they are not read aloud.
 */
function stripCoachBlocks(text: string): string {
  return text.replace(/```coach_blocks[\s\S]*?```/g, "").trim();
}

export interface UseTTSReturn {
  isSpeaking: boolean;
  speakingMessageId: number | null;
  speak: (messageId: number, text: string) => void;
  stop: () => void;
}

export function useTTS(): UseTTSReturn {
  const toast = useToast();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(
    null,
  );
  const sentenceQueueRef = useRef<string[]>([]);
  const currentMessageIdRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  // Bumped by every speak() and stop(). An utterance's callbacks carry the
  // number they started under and are ignored once it is stale: the system
  // reports an interrupted utterance as stopped only after the next one has
  // begun, and that late report must not end the new reading.
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    activeRef.current = false;
    sentenceQueueRef.current = [];
    currentMessageIdRef.current = null;
    Speech.stop()
      .then(() => {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      })
      .catch(() => {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      });
  }, []);

  const speakNextSentence = useCallback(() => {
    // Recursion goes through a local function: a useCallback that names
    // itself is a use-before-declare to the React Compiler.
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    const speakNext = () => {
      const queue = sentenceQueueRef.current;
      if (!activeRef.current || queue.length === 0) {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
        activeRef.current = false;
        return;
      }
      const sentence = queue.shift()!;
      Speech.speak(sentence, {
        language: "en-US",
        onDone: () => {
          if (isCurrent() && activeRef.current) speakNext();
        },
        onStopped: () => {
          if (!isCurrent()) return;
          activeRef.current = false;
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        },
        onError: () => {
          if (!isCurrent()) return;
          activeRef.current = false;
          setIsSpeaking(false);
          setSpeakingMessageId(null);
          toast.error("Couldn't read this aloud. Please try again.");
        },
      });
    };
    speakNext();
  }, [toast]);

  const speak = useCallback(
    (messageId: number, text: string) => {
      // Toggle off if already speaking this message
      if (activeRef.current && currentMessageIdRef.current === messageId) {
        stop();
        return;
      }

      // Stop any current speech before starting new
      if (activeRef.current) {
        Speech.stop().catch(() => {});
      }

      const cleaned = stripMarkdown(stripCoachBlocks(text));
      const sentences = splitSentences(cleaned);
      if (sentences.length === 0) return;

      generationRef.current += 1;
      sentenceQueueRef.current = sentences;
      currentMessageIdRef.current = messageId;
      activeRef.current = true;
      setIsSpeaking(true);
      setSpeakingMessageId(messageId);
      speakNextSentence();
    },
    [stop, speakNextSentence],
  );

  // Stop speech when the component using this hook unmounts
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      activeRef.current = false;
      sentenceQueueRef.current = [];
      Speech.stop().catch(() => {});
    };
  }, []);

  return { isSpeaking, speakingMessageId, speak, stop };
}
