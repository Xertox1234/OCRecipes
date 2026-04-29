import type { FrontLabelExtractionResult } from "@shared/types/front-label";

/**
 * Returns true when AI data should replace locally-extracted data.
 *
 * Replaces when:
 * - AI confidence is high (> 0.7), OR
 * - AI data differs from local on any key field (brand, productName, netWeight)
 *
 * Extracted from FrontLabelConfirmScreen (L11 — 2026-04-28 audit).
 */
export function shouldReplaceWithAIFrontLabel(
  local: FrontLabelExtractionResult,
  ai: FrontLabelExtractionResult,
): boolean {
  return (
    ai.confidence > 0.7 ||
    ai.brand !== local.brand ||
    ai.productName !== local.productName ||
    ai.netWeight !== local.netWeight
  );
}
