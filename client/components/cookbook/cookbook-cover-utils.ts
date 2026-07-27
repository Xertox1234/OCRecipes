/**
 * Pure helpers for the cookbook cover plate. Extracted so Vitest can cover
 * them without rendering — no React or React Native imports here.
 */

/** Shown on the cover before the user has typed a name. */
export const COVER_TITLE_PLACEHOLDER = "Untitled";

/** Book proportion — the plate and the generated art both use 3:4. */
export const COVER_ASPECT_RATIO = 3 / 4;

/** Plate width at rest, and while a field is focused (keyboard up). */
export const COVER_WIDTH_RESTING = 232;
export const COVER_WIDTH_COMPACT = 132;

/**
 * The title as it appears on the cover: the trimmed name, or the placeholder
 * when the user hasn't typed one yet. Whitespace-only input is a placeholder,
 * not a title — otherwise the cover renders a blank plate that looks broken.
 */
export function resolveCoverTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : COVER_TITLE_PLACEHOLDER;
}

/** Whether the cover is showing the placeholder rather than a real title. */
export function isCoverTitlePlaceholder(name: string): boolean {
  return name.trim().length === 0;
}

/**
 * Label for the photo-picker button. It changes with cover state so screen
 * reader users know whether they're adding or replacing — the plate itself is
 * hidden from the a11y tree (it duplicates the name field, and a live preview
 * would announce on every keystroke).
 */
export function coverPhotoActionLabel(hasCover: boolean): string {
  return hasCover ? "Replace cover photo" : "Add cover photo";
}

/**
 * Label for the AI generate button. Free-tier users get the premium suffix so
 * the lock icon isn't the only signal that the action is gated.
 */
export function coverGenerateActionLabel(
  hasCover: boolean,
  canGenerate: boolean,
): string {
  const base = hasCover ? "Generate a new cover" : "Generate a cover";
  return canGenerate ? base : `${base}, premium feature`;
}

/**
 * Plate width for the given layout state, clamped to the screen so the cover
 * never overflows on a small device.
 */
export function resolveCoverWidth(
  screenWidth: number,
  compact: boolean,
  horizontalPadding: number,
): number {
  const target = compact ? COVER_WIDTH_COMPACT : COVER_WIDTH_RESTING;
  const available = screenWidth - horizontalPadding * 2;
  return Math.max(0, Math.min(target, available));
}
