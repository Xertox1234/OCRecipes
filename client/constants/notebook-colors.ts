/**
 * Shared color map for notebook entry types.
 *
 * Colors are fixed-palette values independent of dark/light mode — they serve
 * as category identifiers (semantic hue), not as foreground text on
 * white/cream. Contrast has been verified against both themes via
 * `docs/patterns/design-system.md` WCAG guidelines.
 */
export const TYPE_COLORS: Record<string, string> = {
  commitment: "#f59e0b",
  insight: "#7c6dff",
  goal: "#008A38",
  preference: "#06b6d4",
  coaching_strategy: "#06b6d4",
  motivation: "#ec4899",
  emotional_context: "#ec4899",
  conversation_summary: "#888888",
};
