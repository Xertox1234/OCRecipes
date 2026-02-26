/**
 * Pure styling utilities for Card component.
 * Extracted for testability — no React or RN dependencies.
 */
import { withOpacity } from "@/constants/theme";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

interface ThemeColors {
  backgroundRoot: string;
  backgroundDefault: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  link: string;
}

/** Background color by semantic elevation level. */
export function getBackgroundColorForElevation(
  elevation: number,
  theme: ThemeColors,
): string {
  switch (elevation) {
    case 1:
      return theme.backgroundDefault;
    case 2:
      return theme.backgroundSecondary;
    case 3:
      return theme.backgroundTertiary;
    default:
      return theme.backgroundRoot;
  }
}

/** Badge background and text colors by variant. */
export function getBadgeColors(
  variant: BadgeVariant,
  theme: ThemeColors,
): { bg: string; text: string } {
  switch (variant) {
    case "success":
      return { bg: withOpacity(theme.success, 0.2), text: theme.success };
    case "warning":
      return { bg: withOpacity(theme.warning, 0.2), text: theme.warning };
    case "error":
      return { bg: withOpacity(theme.error, 0.2), text: theme.error };
    case "info":
      return { bg: withOpacity(theme.info, 0.2), text: theme.info };
    default:
      return { bg: withOpacity(theme.link, 0.2), text: theme.link };
  }
}
