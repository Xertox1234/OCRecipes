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
  /** A reply is streaming or the mic is on: the chooser stays shut. */
  disabled: boolean;
  /**
   * Read at tap time: false while another turn is starting (a typed send
   * still creating its conversation), which no rendered state shows yet.
   */
  canStart?: () => boolean;
  /**
   * The conversation to send into, created first if the chat is new. Null
   * when it could not be created; the host must then have told the user and
   * cleared what `onStart` showed, because `onSettled` is not called.
   */
  ensureConversation: () => Promise<number | null>;
  /** Set when this send would open a new chat that showed the brief. */
  openingBriefForm?: "full" | "short";
  /** A photo was picked: show the user's turn before the upload runs. */
  onStart: () => void;
  /**
   * The upload ended; `failure` is null when the server stored the turn.
   * `sentBrief` is whether this send carried the opening brief, latched when
   * the photo was picked (the host's own state has moved on by now).
   */
  onSettled: (
    conversationId: number,
    failure: CoachPhotoFailure | null,
    sentBrief: boolean,
  ) => void | Promise<void>;
  /** The camera or library could not be opened (static copy). */
  onPickFailure: (message: string) => void;
}

/** Pick, upload and settle one photo. Never rejects on an upload failure. */
async function runPhotoSend(
  source: CoachPhotoSource,
  latest: () => Args,
  setSending: (sending: boolean) => void,
): Promise<void> {
  const uri = await pickCoachPhoto(source, (message) =>
    latest().onPickFailure(message),
  );
  if (!uri) return;
  // Latched now: creating the conversation changes what the host passes.
  const a = latest();
  setSending(true);
  a.onStart();
  const conversationId = await a.ensureConversation();
  if (conversationId === null) return;
  let failure: CoachPhotoFailure | null = null;
  try {
    await uploadPhotoToCoach(uri, conversationId, a.openingBriefForm);
  } catch (err) {
    failure = coachPhotoFailure(err);
  }
  await latest().onSettled(
    conversationId,
    failure,
    a.openingBriefForm !== undefined,
  );
}

/**
 * Sending a meal photo into the Coach chat (Coach roadmap S1): choose the
 * camera or the library, upload, and hand the outcome to the chat, which
 * refetches the stored turn and its food card.
 */
export function useCoachPhotoSend(args: Args) {
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);
  // Latest args, read at tap time: the chooser's buttons outlive the render
  // that opened it. Synced after paint; the double-tap guard is `sendingRef`,
  // which is set synchronously.
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });
  const sendingRef = useRef(false);

  const blocked = useCallback(
    () =>
      sendingRef.current ||
      argsRef.current.disabled ||
      argsRef.current.canStart?.() === false,
    [],
  );

  const send = useCallback(
    (source: CoachPhotoSource) => {
      if (blocked()) return Promise.resolve();
      sendingRef.current = true;
      return runPhotoSend(
        source,
        () => argsRef.current,
        setIsSendingPhoto,
      ).finally(() => {
        sendingRef.current = false;
        setIsSendingPhoto(false);
      });
    },
    [blocked],
  );

  const openPhotoChooser = useCallback(() => {
    if (blocked()) return;
    Alert.alert(
      "Send a photo",
      "The Coach will find the foods in your meal and offer to log them.",
      [
        { text: "Take Photo", onPress: () => send("camera") },
        { text: "Choose from Library", onPress: () => send("library") },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [blocked, send]);

  return { openPhotoChooser, isSendingPhoto };
}
