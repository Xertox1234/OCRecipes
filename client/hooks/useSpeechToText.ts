import { useState, useCallback, useRef, useEffect } from "react";
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
  // True from the start() call until the session ends/errors — covers the
  // window before the async "start" event sets activeRef, so unmount cleanup
  // still aborts a recognizer that is spinning up.
  const startedRef = useRef(false);

  useSpeechRecognitionEvent("start", () => {
    activeRef.current = true;
    setIsListening(true);
    setError(null);
  });

  useSpeechRecognitionEvent("end", () => {
    activeRef.current = false;
    startedRef.current = false;
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
    startedRef.current = false;
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

    const permissions =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) {
      setError("Microphone or speech recognition permission not granted.");
      return;
    }

    startedRef.current = true;
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

  // Tear down the recognizer if the component unmounts mid-session — otherwise
  // the native module keeps recording and its events setState an unmounted hook.
  // abort() (not stop()) ends immediately without a final-result event. Gated on
  // startedRef (set synchronously at start()) so it also covers the window before
  // the async "start" event fires, and stays quiet on a truly idle unmount.
  useEffect(() => {
    return () => {
      if (startedRef.current) {
        ExpoSpeechRecognitionModule.abort();
      }
    };
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
