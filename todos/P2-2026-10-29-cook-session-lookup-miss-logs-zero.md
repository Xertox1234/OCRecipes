---
title: "A cook session whose nutrition lookups miss logs 0 kcal silently"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, nutrition, data-integrity]
github_issue:
---

# A cook session whose nutrition lookups miss logs 0 kcal silently

## Summary

When an ingredient's nutrition lookup misses, the cook session counts it as zero (and an unknown portion as 100 g), and `/log` stores the total with no warning.

## Background

Audit finding M-data-5. `server/services/cooking-session.ts` `ingredientPortion` (~209-241) returns `ZERO_NUTRIENTS`; `/api/cooking/sessions/:id/log` persists a `cook_session` scanned item even when every lookup missed. Whether to block the log, warn, or mark the item partial is a product decision.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] The nutrition summary flags ingredients whose lookup missed
- [ ] Logging a session with missed lookups either asks for confirmation or marks the stored item as partial (owner picks)
- [ ] Tests cover an all-miss and a partial-miss session

## Implementation Notes

Since commit d3ffa08a, /log stores `calculateSessionNutrition(...).total`, so the flag can ride on the summary's per-item data.

## Scope Contract

- **Files in scope:** `server/services/cooking-session.ts`, `server/routes/cooking.ts`, `shared/types/cook-session.ts`, `client/screens/CookSessionReviewScreen.tsx` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
