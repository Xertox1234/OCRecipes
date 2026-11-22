/**
 * Pure style values for Button. Extracted for testability — no React or RN
 * dependencies.
 */
import { Spacing, Typography } from "@/constants/theme";

/**
 * The button's box. 52pt is a minimum, not a fixed height: the label has no
 * font-scale cap, so at the iOS accessibility text sizes it is taller than
 * 52pt and a fixed height cut it off top and bottom.
 *
 * The vertical padding is what is left of the 52pt once two lines of body
 * text are in it. It keeps a grown label off the edges, and at the default
 * text size a one-line label and a label that wraps to two lines both still
 * make a 52pt button, so no layout moves.
 */
export const buttonBoxStyle = {
  minHeight: Spacing.buttonHeight,
  paddingVertical: (Spacing.buttonHeight - 2 * Typography.body.lineHeight) / 2,
} as const;
