/**
 * The cover studio's styles. The client sends only a key; the server owns the
 * prompt text for each one (see `server/services/cookbook-cover.ts`), so no
 * style wording ever comes from the request.
 */
export const COOKBOOK_COVER_STYLES = [
  "rustic-terracotta",
  "botanical-parchment",
  "golden-hour",
  "midnight-coral",
] as const;

export type CookbookCoverStyle = (typeof COOKBOOK_COVER_STYLES)[number];

export const DEFAULT_COOKBOOK_COVER_STYLE: CookbookCoverStyle =
  "rustic-terracotta";

export const COOKBOOK_COVER_STYLE_LABELS: Record<CookbookCoverStyle, string> = {
  "rustic-terracotta": "Rustic terracotta",
  "botanical-parchment": "Botanical parchment",
  "golden-hour": "Golden hour",
  "midnight-coral": "Midnight coral",
};

/** Longest "Describe your cover" text the server accepts. */
export const COOKBOOK_COVER_PROMPT_MAX = 200;
