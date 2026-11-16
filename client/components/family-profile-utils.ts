import type { Allergy } from "@shared/schema";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  FAMILY_NAME_MAX,
  FAMILY_NOTE_MAX,
  MAX_FAMILY_PROFILES,
  familyProfileInputSchema,
  type FamilyProfileInput,
} from "@shared/types/family";
import { ApiError } from "@/lib/api-error";
import { COMMON_ALLERGENS } from "@/constants/dietary-options";

const SUMMARY_SHOWN = 3;

/** One line for a profile row: "Peanuts, Dairy/Milk" or "No allergies listed". */
export function summarizeAllergies(allergies: Allergy[]): string {
  if (allergies.length === 0) return "No allergies listed";
  const names = allergies.map(
    (a) => COMMON_ALLERGENS.find((c) => c.id === a.name)?.name ?? a.name,
  );
  const shown = names.slice(0, SUMMARY_SHOWN).join(", ");
  const rest = names.length - SUMMARY_SHOWN;
  return rest > 0 ? `${shown} + ${rest} more` : shown;
}

/**
 * Plain copy for a failed profile write or switch change. Never the raw
 * server text, which is the response body.
 */
export function describeFamilyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ErrorCode.PREMIUM_REQUIRED:
        return "Family profiles are part of Premium.";
      case ErrorCode.HEALTH_CONSENT_REQUIRED:
        return "Agree to the health-data consent to save allergies or a note.";
      case ErrorCode.LIMIT_REACHED:
        return `You can add up to ${MAX_FAMILY_PROFILES} people.`;
      case ErrorCode.RATE_LIMITED:
        return "Too many requests. Please wait a moment and try again.";
    }
  }
  return "Couldn't save. Please try again.";
}

export type FamilyProfileValidation =
  | { ok: true; input: FamilyProfileInput }
  | { ok: false; message: string };

/**
 * The form's check, on the shared schema the server uses (so the limits are
 * never re-declared). The parsed output is what gets sent: trimmed name, a
 * blank note as null.
 */
export function validateFamilyProfile(draft: {
  name: string;
  allergies: Allergy[];
  note: string;
}): FamilyProfileValidation {
  const parsed = familyProfileInputSchema.safeParse(draft);
  if (parsed.success) return { ok: true, input: parsed.data };
  const field = parsed.error.issues[0]?.path[0];
  if (field === "name") {
    return {
      ok: false,
      message:
        draft.name.trim() === ""
          ? "Enter a name for this person."
          : `Use ${FAMILY_NAME_MAX} characters or fewer for the name.`,
    };
  }
  if (field === "note") {
    return {
      ok: false,
      message: `Use ${FAMILY_NOTE_MAX} characters or fewer for the note.`,
    };
  }
  return { ok: false, message: "Check the details and try again." };
}
