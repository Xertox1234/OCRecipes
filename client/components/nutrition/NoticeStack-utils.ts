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
