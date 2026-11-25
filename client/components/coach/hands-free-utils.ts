import type { HandsFreePhase, HandsFreeStopReason } from "@/hooks/useHandsFree";

/**
 * The speech id a hands-free reply is read under. Its own id, not the live
 * reply's (-1) or a saved message's: reading under an id that is already
 * playing would toggle that reading off instead of starting this one.
 */
export const HANDS_FREE_SPEECH_ID = -2;

/** The word shown in the hands-free bar; null while the loop is off. */
export function handsFreeStatus(phase: HandsFreePhase): string | null {
  switch (phase) {
    case "listening":
      return "Listening…";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking…";
    case "off":
      return null;
  }
}

/**
 * What to tell the user when the loop ends by itself. Null when they ended
 * it, or when the failure already has its own message (a speech error toast,
 * the chat's inline error).
 */
export function handsFreeStopMessage(
  reason: HandsFreeStopReason,
): string | null {
  switch (reason) {
    case "silence":
      return "Hands-free stopped: I didn't hear anything.";
    case "background":
      return "Hands-free stopped.";
    case "user":
    case "interrupted":
    case "error":
    case "unavailable":
      return null;
  }
}
