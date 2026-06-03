---
title: "Fix kJ-to-kcal conversion in barcode-lookup to use Codex Alimentarius factor"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Fix kJ-to-kcal conversion in barcode-lookup to use Codex Alimentarius factor

## Summary

`barcode-lookup.ts` converts kJ to kcal using `÷ 4.184` (thermochemical calorie), but the Codex Alimentarius / Open Food Facts standard is `÷ 4.1868` (International Table calorie). This diverges from the label's own `energy-kcal_100g` field.

## Background

Deferred from 2026-06-03 full audit (M4). File: `server/services/barcode-lookup.ts:337`. The difference is ~0.07% per conversion — small per-item but systematically wrong vs the label.

## Acceptance Criteria

- [ ] Conversion uses `4.1868` (International Table calorie)
- [ ] Confirm the converted value matches `energy-kcal_100g` where both are present

## Implementation Notes

Single constant change: `Math.round(nm.energy_100g / 4.1868)`. Also consider adding a fallback to use `energy-kcal_100g` directly when the field is present, which avoids the conversion entirely.

## Dependencies

- None

## Risks

- Negligible numeric change; no schema or data migration needed

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M4)
