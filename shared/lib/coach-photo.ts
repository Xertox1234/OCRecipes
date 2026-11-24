/**
 * The stored text of a photo turn in the Coach chat (Coach roadmap S1 and
 * S2: a meal, a nutrition label or a barcode). The photo itself is never
 * stored, so this line is what the conversation keeps; the app shows the same
 * text while the upload runs.
 */
export const COACH_PHOTO_USER_TEXT = "Sent a photo";

/**
 * The stored text of a turn sent by scanning a barcode with the camera from
 * the Coach chat. The number itself is not kept in the conversation.
 */
export const COACH_BARCODE_USER_TEXT = "Scanned a barcode";
