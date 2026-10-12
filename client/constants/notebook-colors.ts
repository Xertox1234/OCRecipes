/**
 * Colour for a notebook entry type, as a theme token so it follows dark mode.
 * Used as TEXT / dot colour on the card surface (the badge-text tokens are
 * tuned for >= 4.5:1 on backgroundRoot and the card surfaces in both modes) —
 * never as a fill behind white text.
 */
export function notebookTypeColor(
  theme: {
    badgeWarningText: string;
    badgeInfoText: string;
    badgeSuccessText: string;
    badgeErrorText: string;
    badgeNeutralText: string;
    link: string;
  },
  type: string,
): string {
  switch (type) {
    case "commitment":
      return theme.badgeWarningText;
    case "insight":
      return theme.badgeInfoText;
    case "goal":
      return theme.badgeSuccessText;
    case "preference":
    case "coaching_strategy":
      return theme.link;
    case "motivation":
    case "emotional_context":
      return theme.badgeErrorText;
    default:
      return theme.badgeNeutralText;
  }
}
