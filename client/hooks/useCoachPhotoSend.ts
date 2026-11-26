import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, type AlertButton } from "react-native";
import {
  pickCoachPhoto,
  type CoachPhotoSource,
} from "@/lib/coach-photo-picker";
import {
  uploadBarcodeFrontToCoach,
  uploadPhotoToCoach,
} from "@/lib/photo-upload";
import { deleteAsync } from "expo-file-system/legacy";
import { ApiError } from "@/lib/api-error";
import {
  preReadLabel,
  sendLabelToCoach,
  type PhoneLabelRead,
} from "@/lib/coach-label-pre-read";
import { recognizeTextFromPhoto } from "@/camera/utils/recognizeTextFromPhoto";
import {
  awaitCoachBarcode,
  sendBarcodeToCoach,
  settleCoachBarcode,
} from "@/lib/coach-barcode-scan";
import {
  coachPhotoFailure,
  type CoachPhotoFailure,
  type CoachSendKind,
} from "@/components/coach/coach-photo-utils";

/** Where the turn comes from: a photo source, or the live barcode scanner. */
type CoachSendSource = CoachPhotoSource | "scan";

/**
 * What the user picked: a photo's local uri, or a scanned barcode's digits
 * with the label its scanner step read, if any.
 */
type Picked = {
  kind: CoachSendKind;
  value: string;
  label?: PhoneLabelRead;
  /** The front-of-pack photo the scanner's third step took. */
  frontUri?: string;
};

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
  /**
   * Opens the live barcode scanner screen. When set, the chooser offers
   * "Scan a Barcode"; the screen answers through `settleCoachBarcode`.
   */
  openScanner?: () => void;
  /**
   * A photo was picked or a barcode read: show the user's turn before the
   * send runs.
   */
  onStart: (kind: CoachSendKind) => void;
  /**
   * The upload ended; `failure` is null when the server stored the turn.
   * `sentBrief` is whether this send carried the opening brief, latched when
   * the photo was picked (the host's own state has moved on by now).
   * `replyText` is the Coach's stored reply, for the screen reader; null on a
   * failure or when the answer could not be read.
   */
  onSettled: (
    conversationId: number,
    failure: CoachPhotoFailure | null,
    sentBrief: boolean,
    replyText: string | null,
  ) => void | Promise<void>;
  /** The camera or library could not be opened (static copy). */
  onPickFailure: (message: string) => void;
}

/** The photo or barcode for this turn; null when the user backed out. */
async function pick(
  source: CoachSendSource,
  latest: () => Args,
): Promise<Picked | null> {
  if (source === "scan") {
    // Wait first, then open: a read can then never arrive unheard.
    const scanned = awaitCoachBarcode();
    try {
      latest().openScanner?.();
    } catch {
      // No screen opened, so nothing would ever answer the wait.
      settleCoachBarcode(null);
    }
    const scan = await scanned;
    return scan
      ? {
          kind: "barcode",
          value: scan.code,
          label: scan.label,
          frontUri: scan.frontUri,
        }
      : null;
  }
  const uri = await pickCoachPhoto(source, (message) =>
    latest().onPickFailure(message),
  );
  return uri ? { kind: "photo", value: uri } : null;
}

/** Sent, refused or never sent: the scanner's front photo is not kept. */
function discardFront(picked: Picked): void {
  if (picked.frontUri) {
    deleteAsync(picked.frontUri, { idempotent: true }).catch(() => {});
  }
}

/** Pick, send and settle one turn. Never rejects on a send failure. */
async function runPhotoSend(
  source: CoachSendSource,
  latest: () => Args,
  setSending: (sending: boolean) => void,
): Promise<void> {
  const picked = await pick(source, latest);
  if (!picked) return;
  try {
    await sendPicked(picked, latest, setSending);
  } finally {
    discardFront(picked);
  }
}

/** Send what was picked and settle the turn. */
async function sendPicked(
  picked: Picked,
  latest: () => Args,
  setSending: (sending: boolean) => void,
): Promise<void> {
  // Latched now: creating the conversation changes what the host passes.
  const a = latest();
  setSending(true);
  a.onStart(picked.kind);
  const conversationId = await a.ensureConversation();
  if (conversationId === null) return;
  let failure: CoachPhotoFailure | null = null;
  let replyText: string | null = null;
  try {
    if (picked.kind === "barcode" && picked.frontUri && picked.label) {
      // The AI model reads the front: a photo upload, not the JSON turn.
      replyText = await uploadBarcodeFrontToCoach(
        picked.frontUri,
        conversationId,
        {
          barcode: picked.value,
          label: picked.label,
          ...(a.openingBriefForm && { openingBrief: a.openingBriefForm }),
        },
      );
    } else if (picked.kind === "barcode") {
      replyText = await sendBarcodeToCoach(
        picked.value,
        conversationId,
        a.openingBriefForm,
        picked.label,
      );
    } else {
      // A nutrition label the phone can read itself goes as numbers, and the
      // photo stays on the phone (Coach roadmap V5); anything else uploads.
      const label = await preReadLabel(picked.value, recognizeTextFromPhoto);
      const sentAsNumbers = label
        ? await sendLabelToCoach(
            label,
            conversationId,
            a.openingBriefForm,
          ).then(
            (text) => ({ text }),
            (err: unknown) => {
              // Turned away unread (nothing stored): the photo goes instead,
              // or the same numbers would be refused on every resend. Any
              // other refusal may have stored the turn, so nothing is resent.
              if (err instanceof ApiError && err.status === 400) return null;
              throw err;
            },
          )
        : null;
      replyText = sentAsNumbers
        ? sentAsNumbers.text
        : await uploadPhotoToCoach(
            picked.value,
            conversationId,
            a.openingBriefForm,
          );
    }
  } catch (err) {
    failure = coachPhotoFailure(err, picked.kind);
  }
  await latest().onSettled(
    conversationId,
    failure,
    a.openingBriefForm !== undefined,
    replyText,
  );
}

/**
 * Sending a photo or a scanned barcode into the Coach chat (Coach roadmap S1
 * and S2): choose the scanner, the camera or the library, send, and hand the
 * outcome to the chat, which refetches the stored turn and its food card.
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
  // The chat going away ends a wait on the scanner, so nothing is sent for
  // a chat that is no longer there. A no-op when nothing is waiting.
  useEffect(() => () => settleCoachBarcode(null), []);

  const blocked = useCallback(
    () =>
      sendingRef.current ||
      argsRef.current.disabled ||
      argsRef.current.canStart?.() === false,
    [],
  );

  const send = useCallback(
    (source: CoachSendSource) => {
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
    const buttons: AlertButton[] = [
      { text: "Take Photo", onPress: () => send("camera") },
      { text: "Choose from Library", onPress: () => send("library") },
    ];
    if (!argsRef.current.openScanner) {
      Alert.alert(
        "Send a photo",
        "A meal, a nutrition label, a barcode, a grocery receipt or a menu. The Coach will offer to log it, add it to your pantry or help you order.",
        [...buttons, { text: "Cancel", style: "cancel" }],
      );
      return;
    }
    buttons.unshift({ text: "Scan a Barcode", onPress: () => send("scan") });
    const message =
      "Scan a barcode, or send a photo of a meal, a nutrition label, a grocery receipt or a menu. The Coach will offer to log it, add it to your pantry or help you order.";
    // An Android alert shows at most three buttons, so there Cancel is the
    // back button or a tap outside.
    if (Platform.OS === "android") {
      Alert.alert("Log with the camera", message, buttons, {
        cancelable: true,
      });
    } else {
      Alert.alert("Log with the camera", message, [
        ...buttons,
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }, [blocked, send]);

  /** True from the tap on a source until the send settles (picker included). */
  const isPhotoBusy = useCallback(() => sendingRef.current, []);

  return { openPhotoChooser, isSendingPhoto, isPhotoBusy };
}
