---
title: "Split community.ts and meal-plan-recipes.ts under the 500-line cap"
status: backlog
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, architecture]
github_issue:
---

# Split community.ts and meal-plan-recipes.ts under the 500-line cap

## Summary

Two storage modules exceed the 500-line split threshold (rule 1):
`server/storage/community.ts` (563) and `server/storage/meal-plan-recipes.ts`
(578). Split each by sub-domain to restore compliance.

## Background

Found in the 2026-05-20 full audit (L5). The growth this window was inline
allergen-cache derivation folded into existing CRUD functions — no new exported
functions were added, so rule 8 ("avoid adding new functions") was respected;
only the rule 1 line-count cap is breached. `chat.ts` (576) is also over but was
unchanged this window (out of scope here).

## Acceptance Criteria

- [ ] `meal-plan-recipes.ts` split (e.g. browser-query functions vs mutation/index)
- [ ] `community.ts` split (e.g. recipe CRUD vs generation-log)
- [ ] Both resulting modules are under 500 lines
- [ ] The storage facade (`server/storage/index.ts`) re-exports unchanged — no
      call-site churn outside the facade

## Implementation Notes

Pure mechanical extraction; verify the facade re-export surface is identical with
the LSP tool (`findReferences`) before/after so no consumer breaks.

## Risks

- Splitting can churn imports; keep the public surface via the facade stable.

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, finding L5).
