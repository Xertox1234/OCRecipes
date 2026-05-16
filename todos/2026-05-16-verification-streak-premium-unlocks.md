---
title: "Verification streak premium unlocks (actual feature unlocks, not just display)"
status: backlog
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, product]
github_issue:
---

# Verification streak premium unlocks (actual feature unlocks, not just display)

## Summary

`docs/ROADMAP.md` lists "Verification streak premium unlocks" as a backlog item — granting real premium feature unlocks (not just a streak badge/display) to users with high barcode-verification activity. It currently has no tracking todo.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding L2). The ROADMAP "Lower-priority backlog" table listed this item with no corresponding todo, so it risked being silently dropped. This todo exists purely to track it; it is not yet scheduled work.

## Acceptance Criteria

- [ ] Decide which premium feature(s) a verification streak unlocks and the streak threshold
- [ ] Define how the unlock interacts with the existing subscription/premium-feature system (`usePremiumFeature`, `TIER_FEATURES`)
- [ ] Implement the unlock grant + expiry logic
- [ ] Surface the unlock state to the user

## Implementation Notes

- Verification streak display already exists; this is specifically the _functional unlock_ beyond display.
- Must integrate with the premium-feature gating in `client/hooks/usePremiumFeatures.ts` / `@shared/types/premium`.
- Relates to the Verified Product API business strategy — high verifiers feed the verified-product DB.

## Dependencies

- Premium-feature/subscription system
- Verification streak tracking (already implemented for display)

## Risks

- Unclear product definition — needs a product decision on threshold and which features unlock before implementation.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding L2)
