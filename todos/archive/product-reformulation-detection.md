---
title: "Detect product reformulations from divergent verification scans"
status: done
priority: medium
created: 2026-03-20
updated: 2026-03-25
assignee:
labels: [data-quality, verification, api]
---

# Product Reformulation Detection

## Summary

When new barcode verification scans consistently disagree with the existing verified consensus, the product may have been reformulated. Detect this and flag verified products for re-verification to maintain data accuracy.

## Background

The verified product database is a revenue-generating API asset. If a manufacturer reformulates a product (e.g., changes sugar content), the existing verified data becomes stale. Without detection, the API serves incorrect nutrition data, undermining trust with paying customers.

## Acceptance Criteria

- [ ] New verification scans are compared against existing consensus
- [ ] When N consecutive scans (e.g., 3+) diverge beyond tolerance (5%) from consensus, flag the product
- [ ] Flagged products are marked for re-verification (reset verified status or add "possibly reformulated" flag)
- [ ] Admin/API visibility into flagged products
- [ ] Old consensus data preserved for audit trail (not deleted)
- [ ] Notification or log entry when reformulation is detected

## Implementation Notes

- The verification comparison service already uses 5% tolerance on calories/protein/carbs/fat
- Could add a `reformulationFlags` table or a status field on `barcodeVerifications`
- Consider time-based weighting — recent scans should matter more than old ones
- Edge case: user scanning the wrong product (mismatched barcode) should not trigger reformulation flag — need multiple independent users to diverge

## Dependencies

- Existing verification pipeline (shipped)
- Sufficient scan volume per product to detect divergence reliably

## Risks

- False positives from user error (wrong product scanned, damaged labels)
- Need enough scan volume to distinguish signal from noise
- Deciding when to auto-reset vs. manual review

## Updates

### 2026-03-20

- Initial creation from brainstorm session
