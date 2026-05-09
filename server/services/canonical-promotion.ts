/**
 * Canonical recipe promotion background job.
 *
 * Runs every 6 hours. Queries community recipes that have crossed the
 * popularity threshold (via storage.getEligibleForPromotion), marks them
 * canonical, then fire-and-forgets the enrichment pipeline for each one.
 *
 * The enrichment pipeline (canonical-enrichment.ts) is implemented in Task 5
 * and is decoupled — its failures are logged individually and do not block
 * promotion from completing.
 *
 * Usage: call startPromotionJob() once at server startup.
 */
import pLimit from "p-limit";
import { createServiceLogger, toError } from "../lib/logger";
import { storage } from "../storage";
import { enrichRecipe } from "./canonical-enrichment";

const log = createServiceLogger("canonical-promotion");

const PROMOTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ENRICHMENT_CONCURRENCY = 2;

// Module-level limiter — persists between runs so concurrent enrichments across
// overlapping intervals are also bounded.
const enrichLimit = pLimit(ENRICHMENT_CONCURRENCY);

// Overlap guard — prevents a second run from starting while one is still active.
let isRunning = false;

/**
 * Query eligible recipes, mark each canonical, and fire-and-forget enrichment.
 * Exported for testing and manual invocation.
 */
export async function runPromotionJob(): Promise<void> {
  if (isRunning) {
    log.warn("canonical-promotion: skipping run — previous run still active");
    return;
  }
  isRunning = true;
  try {
    const eligible = await storage.getEligibleForPromotion(10);

    if (eligible.length === 0) return;

    log.info(
      { count: eligible.length },
      "canonical-promotion: promoting recipes",
    );

    // Step 1: mark canonical (skip recipes that are already canonical — re-enrich path)
    const toPromote = eligible.filter((r) => !r.isCanonical);
    if (toPromote.length > 0) {
      await Promise.all(toPromote.map((r) => storage.markCanonical(r.id)));
    }

    // Step 2: fire enrichments rate-limited (max 2 concurrent)
    // Includes both newly-promoted recipes and previously-promoted ones
    // where enrichment failed (canonicalEnrichedAt still null).
    for (const recipe of eligible) {
      enrichLimit(() => enrichRecipe(recipe.id)).catch((err) =>
        log.error(
          { err: toError(err), recipeId: recipe.id },
          "canonical-promotion: enrichment failed for recipe",
        ),
      );
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the 6-hour promotion interval.
 * Returns the interval handle so callers can clear it if needed.
 */
export function startPromotionJob(): ReturnType<typeof setInterval> {
  log.info(
    { intervalMs: PROMOTION_INTERVAL_MS },
    "canonical-promotion: starting promotion job (6h interval)",
  );

  return setInterval(() => {
    runPromotionJob().catch((err) => {
      log.error(
        { err: toError(err) },
        "canonical-promotion: unhandled error in promotion job",
      );
    });
  }, PROMOTION_INTERVAL_MS);
}
