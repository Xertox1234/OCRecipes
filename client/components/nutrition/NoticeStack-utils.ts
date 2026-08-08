/**
 * Collapses the screen's advisory inputs into one ordered row list. Pure.
 *
 * `error` is deliberately NOT here: error messages require `assertive` and
 * render through `InlineError`, which fires its own iOS-gated announce. Routing
 * it through this module's announcer would make iOS hear it twice.
 *
 * `ScanConflictPrompt` is also absent — it is interactive (it offers a source
 * choice) and must not be flattened into a passive row.
 */
export type NoticeSeverity = "warning" | "info";

export interface Notice {
  id: "label-read" | "correction" | "per-100g";
  severity: NoticeSeverity;
  icon: "alert-triangle" | "zap" | "info";
  title: string;
  body: string;
}

export interface BuildNoticesInput {
  labelReadNotice: string | null;
  correctionNotice: string | null;
  showPer100gInfo: boolean;
}

/**
 * Background opacity per severity, passed to `withOpacity(color, …)`.
 *
 * Here rather than in the component because it is half of a WCAG contrast
 * pair: `__tests__/badge-contrast.test.ts` composites `NOTICE_TEXT_COLOR_KEY`'s
 * token over each page surface at exactly this alpha, so the two must be
 * enumerable together from a module that suite can import. Same factoring as
 * `badge-severity-visuals.ts` + `BADGE_SEVERITY_FILL_OPACITY`.
 */
export const NOTICE_FILL_OPACITY: Record<NoticeSeverity, number> = {
  warning: 0.1,
  info: 0.08,
};

/**
 * Which theme token the notice's TITLE and BODY render at — deliberately not
 * the same token as the fill and the icon.
 *
 * The fill keeps `theme.warning` / `theme.info` (that is the look), but those
 * two are display colours, not text colours: at full strength on their own
 * 10%/8% fill, light mode measures `#F57C00` at 2.30:1 on `backgroundRoot`
 * (2.45:1 on `surface`) and `#2196F3` at 2.67:1 — all far under WCAG 1.4.3's
 * 4.5:1 for normal text. Dark mode passed. The `badge*Text` tokens are the
 * AA-verified counterparts already used by every other low-opacity pill in the
 * app, and `badge-contrast.test.ts` derives its notice cases from THIS map, so
 * pointing notice text back at a display token fails the suite.
 */
export const NOTICE_TEXT_COLOR_KEY: Record<
  NoticeSeverity,
  "badgeWarningText" | "badgeInfoText"
> = {
  warning: "badgeWarningText",
  info: "badgeInfoText",
};

/** Severity order is the render order: warnings lead. */
export function buildNotices(input: BuildNoticesInput): Notice[] {
  const notices: Notice[] = [];

  if (input.labelReadNotice) {
    notices.push({
      id: "label-read",
      severity: "warning",
      icon: "alert-triangle",
      title: "Label not used",
      body: input.labelReadNotice,
    });
  }
  if (input.correctionNotice) {
    notices.push({
      id: "correction",
      severity: "warning",
      icon: "zap",
      title: "Serving size adjusted",
      body: input.correctionNotice,
    });
  }
  if (input.showPer100gInfo) {
    notices.push({
      id: "per-100g",
      severity: "info",
      icon: "info",
      title: "Per 100g",
      body: "Values shown per 100g. Check package for actual serving size.",
    });
  }

  return notices;
}

/**
 * The announcer's edge guard. Keyed on the composed CONTENT rather than on the
 * set of notice ids: `correctionNotice`'s text mutates on every serving
 * adjustment while its id stays `"correction"`, so an id-keyed guard would
 * announce the first correction and silently skip every one after it. This is
 * the ProductChip precedent.
 */
export function noticeAnnouncementKey(notices: Notice[]): string | null {
  if (notices.length === 0) return null;
  return notices.map((n) => `${n.title}. ${n.body}`).join(" ");
}
