/**
 * Pure helpers for `backfill-recipe-images.ts`.
 *
 * Extracted so the spend guard and flag parsing can be unit-tested without a
 * DB connection — the script runs `main()` at module load, so it cannot be
 * imported in a test (mirrors seed-recipes-utils.ts).
 */

export interface BackfillFlags {
  dryRun: boolean;
  includeCanonical: boolean;
  bumpOnly: boolean;
  fillMissing: boolean;
  limit: number;
}

/** Parse the backfill CLI flags from a full argv array. */
export function parseBackfillFlags(argv: readonly string[]): BackfillFlags {
  const limitFlag = argv.indexOf("--limit");
  let limit = Infinity;
  if (limitFlag >= 0) {
    // `--limit five` used to parse to NaN, and every NaN comparison is false —
    // the cap silently never engaged on a script that spends money per image.
    limit = Number(argv[limitFlag + 1]);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(
        `--limit requires a positive integer (got ${JSON.stringify(argv[limitFlag + 1] ?? "")})`,
      );
    }
  }
  return {
    dryRun: argv.includes("--dry-run"),
    includeCanonical: argv.includes("--include-canonical"),
    bumpOnly: argv.includes("--bump-version-only"),
    fillMissing: argv.includes("--fill-missing"),
    limit,
  };
}

/**
 * The spend guard: a live run (not dry-run, not bump-only) regenerates images
 * through Runware and must refuse up front when the API key is missing —
 * otherwise the failure surfaces mid-run after partial writes.
 */
export function evaluateBackfillGuard(opts: {
  dryRun: boolean;
  bumpOnly: boolean;
  runwareConfigured: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.dryRun && !opts.bumpOnly && !opts.runwareConfigured) {
    return {
      ok: false,
      reason: "RUNWARE_API_KEY not set — image generation unavailable.",
    };
  }
  return { ok: true };
}
