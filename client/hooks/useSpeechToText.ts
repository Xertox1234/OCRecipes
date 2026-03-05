import { useState, useCallback, useRef } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { VOLUME_SILENT } from "@/lib/volume-scale";

export function useSpeechToText() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isFinal, setIsFinal] = useState(false);
  const [volume, setVolume] = useState(VOLUME_SILENT);
  const [error, setError] = useState<string | null>(null);

  // Track whether we initiated listening to ignore stale events
  const activeRef = useRef(false);

  useSpeechRecognitionEvent("start", () => {
    activeRef.current = true;
    setIsListening(true);
    setError(null);
  });

  useSpeechRecognitionEvent("end", () => {
    activeRef.current = false;
    setIsListening(false);
    setVolume(VOLUME_SILENT);
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!activeRef.current) return;
    const text = event.results[0]?.transcript ?? "";
    setTranscript(text);
    setIsFinal(event.isFinal);
  });

  useSpeechRecognitionEvent("error", (event) => {
    activeRef.current = false;
    setIsListening(false);
    setVolume(VOLUME_SILENT);

    switch (event.error) {
      case "not-allowed":
        setError("Microphone or speech recognition permission not granted.");
        break;
      case "no-speech":
      case "speech-timeout":
        setError("No speech detected. Please try again.");
        break;
      default:
        setError("Speech recognition failed. Please try again.");
        break;
    }
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (activeRef.current) {
      setVolume(event.value);
    }
  });

  const startListening = useCallback(async () => {
    setTranscript("");
    setIsFinal(false);
    setError(null);

    const { granted } =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      setError("Microphone or speech recognition permission not granted.");
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  }, []);

  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return {
    isListening,
    transcript,
    isFinal,
    volume,
    error,
    startListening,
    stopListening,
  };
}
