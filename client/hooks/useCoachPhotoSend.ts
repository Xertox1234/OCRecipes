import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  pickCoachPhoto,
  type CoachPhotoSource,
} from "@/lib/coach-photo-picker";
import { uploadPhotoToCoach } from "@/lib/photo-upload";
import {
  coachPhotoFailure,
  type CoachPhotoFailure,
} from "@/components/coach/coach-photo-utils";

interface Args {
  /** A reply is streaming: the button is off and the chooser stays shut. */
  disabled: boolean;
  /**
   * The conversation to send into, created first if the chat is new. Null
   * when it could not be created (the host has already told the user).
   */
  ensureConversation: () => Promise<number | null>;
  /** Set when this send would open a new chat that showed the brief. */
  openingBriefForm?: "full" | "short";
  /** A photo was picked: show the user's turn before the upload runs. */
  onStart: () => void;
  /** The upload ended; `failure` is null when the server stored the turn. */
  onSettled: (
    conversationId: number,
    failure: CoachPhotoFailure | null,
  ) => void | Promise<void>;
  /** The camera or library could not be opened (static copy). */
  onPickFailure: (message: string) => void;
}

/**
 * Sending a meal photo into the Coach chat (Coach roadmap S1): choose the
 * camera or the library, upload, and hand the outcome to the chat, which
 * refetches the stored turn and its food card.
 */
export function useCoachPhotoSend(args: Args) {
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);
  // Latest args and the in-flight flag, read at tap time: the chooser's
  // buttons outlive the render that opened it.
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });
  const sendingRef = useRef(false);

  const send = useCallback(async (source: CoachPhotoSource) => {
    if (sendingRef.current || argsRef.current.disabled) return;
    sendingRef.current = true;
    try {
      const uri = await pickCoachPhoto(source, (message) =>
        argsRef.current.onPickFailure(message),
      );
      if (!uri) return;
      const a = argsRef.current;
      setIsSendingPhoto(true);
      a.onStart();
      const conversationId = await a.ensureConversation();
      if (conversationId === null) return;
      let failure: CoachPhotoFailure | null = null;
      try {
        await uploadPhotoToCoach(uri, conversationId, a.openingBriefForm);
      } catch (err) {
        failure = coachPhotoFailure(err);
      }
      await argsRef.current.onSettled(conversationId, failure);
    } finally {
      sendingRef.current = false;
      setIsSendingPhoto(false);
    }
  }, []);

  const openPhotoChooser = useCallback(() => {
    if (sendingRef.current || argsRef.current.disabled) return;
    Alert.alert(
      "Send a photo",
      "The Coach will find the foods in your meal and offer to log them.",
      [
        { text: "Take Photo", onPress: () => send("camera") },
        { text: "Choose from Library", onPress: () => send("library") },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [send]);

  return { openPhotoChooser, isSendingPhoto };
}
