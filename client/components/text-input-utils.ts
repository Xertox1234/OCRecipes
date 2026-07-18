// Pure logic for TextInput's animated focus border and floating label,
// extracted so Vitest can cover it (see client/components/*-utils.ts pattern).
import { withOpacity } from "@/constants/theme";

/** Label floats when the field has focus or content. */
export function shouldFloatLabel(
  isFocused: boolean,
  value: string | undefined,
): boolean {
  return isFocused || (value?.length ?? 0) > 0;
}

/**
 * Rest-state border color for the focus interpolation. Light mode keeps the
 * subtle theme border; dark mode rests on a fully transparent link tint so the
 * focus transition stays in-hue instead of fading through gray.
 */
export function getRestBorderColor(
  isDark: boolean,
  themeBorder: string,
  themeLink: string,
): string {
  return isDark ? withOpacity(themeLink, 0) : themeBorder;
}

/**
 * With a floating label the placeholder only appears once the label has
 * floated out of its way; without a label it passes through untouched.
 */
export function resolvePlaceholder(
  label: string | undefined,
  placeholder: string | undefined,
  floated: boolean,
): string | undefined {
  if (!label) return placeholder;
  return floated ? placeholder : undefined;
}

/** The visible label doubles as the input's accessible name unless overridden. */
export function resolveInputAccessibilityLabel(
  explicit: string | undefined,
  label: string | undefined,
): string | undefined {
  return explicit ?? label;
}
