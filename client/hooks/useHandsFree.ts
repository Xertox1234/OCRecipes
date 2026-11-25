import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { SpeechErrorKind } from "@/hooks/useSpeechToText";

/**
 * Where the hands-free loop is: waiting for the user to speak, waiting for
 * the Coach's reply, or reading that reply aloud.
 */
export type HandsFreePhase = "off" | "listening" | "thinking" | "speaking";

/** Why the loop ended. */
export type HandsFreeStopReason =
  | "user"
  | "silence"
  | "error"
  | "interrupted"
  | "background"
  | "unavailable";

interface Args {
  /** False where hands-free may not run (no voice, a screen reader is on). */
  available: boolean;
  /** The speech recognizer's state (useSpeechToText). */
  isListening: boolean;
  isFinal: boolean;
  transcript: string;
  speechErrorKind: SpeechErrorKind | null;
  startListening: () => Promise<void> | void;
  /**
   * Close the microphone when the loop is stopped. It must not deliver the
   * words heard so far as a final result: the host would send them.
   */
  stopListening: () => void;
  /**
   * Read a reply aloud. The host reports its end with `spokenFinished`.
   * Returning false means nothing was read (the reply was only a card).
   */
  speak: (text: string) => boolean | void;
  stopSpeaking: () => void;
  onStopped?: (reason: HandsFreeStopReason) => void;
}

/**
 * Hands-free turn-taking for the Coach chat (Coach roadmap V2): listen, let
 * the host send what was heard, speak the reply, listen again.
 *
 * This hook only keeps the loop's place and opens and closes the microphone
 * and the voice. The host sends the final transcript (it already does for a
 * tap on the mic) and reports the reply: `replyDone` / `replyFailed` from the
 * stream, `spokenFinished` / `speechInterrupted` from the voice.
 *
 * The microphone is never open while the reply is being read: with no echo
 * cancellation it would hear the Coach and send that as the user's turn.
 */
export function useHandsFree(args: Args) {
  const [phase, setPhaseState] = useState<HandsFreePhase>("off");
  // Read by callbacks in the same tick a transition happens.
  const phaseRef = useRef<HandsFreePhase>("off");
  // Latest inputs, read when a transition happens.
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });
  // The microphone has opened in this listening phase. Until it has, the
  // recognizer still shows the previous turn's final result.
  const micOpenedRef = useRef(false);

  const setPhase = useCallback((next: HandsFreePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const stop = useCallback(
    (reason: HandsFreeStopReason = "user") => {
      const was = phaseRef.current;
      if (was === "off") return;
      setPhase("off");
      if (was === "listening") argsRef.current.stopListening();
      if (was === "speaking") argsRef.current.stopSpeaking();
      argsRef.current.onStopped?.(reason);
    },
    [setPhase],
  );

  const listen = useCallback(() => {
    micOpenedRef.current = false;
    setPhase("listening");
    // A start that fails without an error event would leave the loop
    // "listening" to a microphone that never opened.
    const failed = () => {
      if (phaseRef.current === "listening") stop("error");
    };
    try {
      Promise.resolve(argsRef.current.startListening()).catch(failed);
    } catch {
      failed();
    }
  }, [setPhase, stop]);

  const start = useCallback(() => {
    if (!argsRef.current.available || phaseRef.current !== "off") return;
    listen();
  }, [listen]);

  /** The Coach's reply has arrived in full. */
  const replyDone = useCallback(
    (text: string) => {
      if (phaseRef.current !== "thinking") return;
      const spoken = text.trim();
      if (!spoken) {
        listen();
        return;
      }
      setPhase("speaking");
      // Nothing readable: no end-of-reading will ever be reported.
      if (argsRef.current.speak(spoken) === false) listen();
    },
    [listen, setPhase],
  );

  /** The turn failed (a stream error, the daily limit). */
  const replyFailed = useCallback(() => stop("error"), [stop]);

  /** The reply was read to its end. */
  const spokenFinished = useCallback(() => {
    if (phaseRef.current === "speaking") listen();
  }, [listen]);

  /** The reading stopped before its end (the user stopped it, or it failed). */
  const speechInterrupted = useCallback(() => {
    if (phaseRef.current === "speaking") stop("interrupted");
  }, [stop]);

  const { available, isListening, isFinal, transcript, speechErrorKind } = args;
  // Follows the recognizer, which reports through state rather than events.
  useEffect(() => {
    if (phaseRef.current === "off") return;
    if (!available) {
      stop("unavailable");
      return;
    }
    if (phaseRef.current !== "listening") return;
    if (speechErrorKind) {
      stop(speechErrorKind === "no-speech" ? "silence" : "error");
      return;
    }
    if (isListening) micOpenedRef.current = true;
    if (!micOpenedRef.current) return;
    if (isFinal && transcript) {
      // Heard: the host sends it. Set before the host's own effect runs, so
      // it can tell this send from a typed one.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the recognizer reports through state, so its end is only visible here
      setPhase("thinking");
      return;
    }
    if (!isListening) stop("silence");
  }, [
    available,
    isListening,
    isFinal,
    transcript,
    speechErrorKind,
    phase,
    setPhase,
    stop,
  ]);

  // An open microphone does not outlive the app being in front. "inactive"
  // is not that: iOS reports it for a permission dialog or Control Center.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") stop("background");
    });
    return () => subscription.remove();
  }, [stop]);

  // Going away mid-listen closes the microphone (docs/rules/react-native.md).
  useEffect(
    () => () => {
      if (phaseRef.current === "listening") argsRef.current.stopListening();
    },
    [],
  );

  return {
    phase,
    phaseRef,
    start,
    stop,
    replyDone,
    replyFailed,
    spokenFinished,
    speechInterrupted,
  };
}
