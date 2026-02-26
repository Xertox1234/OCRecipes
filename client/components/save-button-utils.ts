/**
 * Pure state-to-UI mapping utilities for SaveButton.
 * Extracted for testability — no React or RN dependencies.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

/** Feather icon name for each save state. */
export function getSaveIconName(
  saveState: SaveState,
): "bookmark" | "check" | "alert-circle" {
  switch (saveState) {
    case "saved":
      return "check";
    case "error":
      return "alert-circle";
    default:
      return "bookmark";
  }
}

/** Background color key for each save state. */
export function getSaveBackgroundColorKey(
  saveState: SaveState,
): "success" | "error" | "backgroundSecondary" {
  switch (saveState) {
    case "saved":
      return "success";
    case "error":
      return "error";
    default:
      return "backgroundSecondary";
  }
}

/** Icon color key for each save state. */
export function getSaveIconColorKey(
  saveState: SaveState,
): "buttonText" | "text" {
  switch (saveState) {
    case "saved":
    case "error":
      return "buttonText";
    default:
      return "text";
  }
}

/** Accessibility label for each save state. */
export function getSaveAccessibilityLabel(
  saveState: SaveState,
  itemTitle: string,
): string {
  switch (saveState) {
    case "saving":
      return "Saving item";
    case "saved":
      return "Item saved";
    case "error":
      return "Failed to save, tap to retry";
    default:
      return `Save ${itemTitle}`;
  }
}
