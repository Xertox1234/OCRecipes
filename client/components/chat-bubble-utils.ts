/**
 * The assistant bubble is one `accessible` element (VoiceOver reads the whole
 * reply as one stop), and on iOS an accessible element swallows its children —
 * so the visual "Read aloud" button is touch-only and the row offers speaking
 * as a custom accessibility action instead (VoiceOver rotor / TalkBack
 * actions menu).
 */
export const SPEAK_ACTION = "speak";

export function getSpeakAccessibilityActions(
  canSpeak: boolean,
  isSpeaking: boolean,
): { name: string; label: string }[] | undefined {
  if (!canSpeak) return undefined;
  return [
    {
      name: SPEAK_ACTION,
      label: isSpeaking ? "Stop reading aloud" : "Read aloud",
    },
  ];
}

export function handleSpeakAccessibilityAction(
  actionName: string,
  onSpeak: (() => void) | undefined,
): void {
  if (actionName === SPEAK_ACTION) onSpeak?.();
}
