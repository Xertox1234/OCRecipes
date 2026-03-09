/**
 * Type guards for JSONB fields on UserProfile.
 *
 * UserProfile stores allergies and foodDislikes as JSONB columns whose
 * runtime shape is `unknown`. These guards narrow them safely.
 */

export function isAllergyArray(value: unknown): value is { name: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string",
    )
  );
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
