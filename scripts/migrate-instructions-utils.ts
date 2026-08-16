/**
 * Pure helpers for `migrate-instructions.ts` — zero-dependency leaf so the
 * parser and the re-run guard are unit-testable (the script connects to
 * Postgres and runs `migrate()` at module load).
 */

export function parseTextToSteps(text: string): string[] {
  if (!text || !text.trim()) return [];

  // Strip HTML tags (Spoonacular / imported recipes)
  const cleaned = text.replace(/<[^>]*>/g, "").trim();
  if (!cleaned) return [];

  // Try splitting on numbered patterns: "1. ", "1) ", "Step 1:", "Step 1 -"
  const numberedPattern = /(?:^|\n)\s*(?:step\s+)?\d+[.):-]\s*/i;
  if (numberedPattern.test(cleaned)) {
    const steps = cleaned
      .split(/\n\s*(?:(?:step\s+)?\d+[.):-]\s*)/i)
      .map((s) => s.replace(/^(?:step\s+)?\d+[.):-]\s*/i, "").trim())
      .filter((s) => s.length > 0);
    if (steps.length > 1) return steps;
  }

  // Try splitting on double newlines (paragraph-style)
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (paragraphs.length > 1) return paragraphs;

  // Fall back to single newlines
  const lines = cleaned
    .split(/\n/)
    .map((s) => s.replace(/^[-*•]\s*/, "").trim()) // strip bullet markers
    .filter((s) => s.length > 0);
  if (lines.length > 1) return lines;

  // Single block of text — return as one step
  return [cleaned];
}

/**
 * Re-run guard: the migration DROPs and recreates its own backup tables as
 * step 1, so an accidental second run used to destroy the only rollback point
 * while the error handler still promised "Backup tables exist for rollback."
 */
export function evaluateRerunGuard(opts: {
  backupsExist: boolean;
  force: boolean;
}): { refuse: boolean; reason?: string } {
  if (opts.backupsExist && !opts.force) {
    return {
      refuse: true,
      reason:
        "Backup tables from a previous run exist; re-running would DROP them and destroy your rollback point. Drop them manually or pass --force-rerun.",
    };
  }
  return { refuse: false };
}
