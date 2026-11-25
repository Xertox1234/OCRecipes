import { containsUnsafeCoachAdvice } from "../lib/ai-safety";
import { mentionsHealthCondition } from "../lib/health-note-screen";

/**
 * Why a note the user adds cannot be saved, or null. The same filters the
 * Coach's own extraction applies before it saves (notebook-extraction.ts):
 * the manual routes used to store any text and mark it confirmed, and
 * confirmed notes are stated back by Coach.
 */
export function refusedNoteText(content: string): string | null {
  if (/\ballerg/i.test(content)) {
    return "Allergies belong in your dietary profile, where recipes are checked against them. Add it under Profile.";
  }
  if (containsUnsafeCoachAdvice(content)) {
    return "That can't be saved as a note. Coach's notes can't hold medical or extreme-diet instructions.";
  }
  if (mentionsHealthCondition(content)) {
    return "Health conditions and medications aren't kept in Coach's notes. A condition belongs in your dietary profile, under Profile.";
  }
  return null;
}
