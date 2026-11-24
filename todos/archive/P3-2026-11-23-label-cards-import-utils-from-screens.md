---
title: "Label cards and hook import pure helpers from client/screens"
status: done
priority: low
created: 2026-11-23
updated: 2026-11-23
assignee:
labels: [client, maintainability]
github_issue:
---

# Label cards and hook import pure helpers from client/screens

## Summary

Three files outside `client/screens/` import from `@/screens/label-analysis-utils`. Shared
pure logic belongs in `client/components/`, `client/lib/` or `client/camera/utils/`.

## Background

Found by the `mobile-reviewer` on PR #1993, which added the third import and left the move
out of scope (that todo's contract allowed no new files).

- `client/components/LabelServingsCard.tsx` (`servingsCountLabel`, added by #1993)
- `client/components/LabelNutritionFactsCard.tsx` (already on `main`)
- `client/hooks/useLabelAnalysisSession.ts` (already on `main`)

## Acceptance Criteria

- [x] No file outside `client/screens/` and `client/navigation/` imports from
      `@/screens/label-analysis-utils` (test files beside the screen excepted).
- [x] The helpers keep their Vitest coverage after the move.

## Implementation Notes

Move the helpers the cards and the hook use to a utils module under `client/components/` or
`client/lib/`, and import it from the screen too. A move only: no behaviour change.

## Scope Contract

- **Mechanisms to use:** a file move and import updates.
- **Files in scope:** `client/screens/label-analysis-utils.ts`, its test file, the three
  importers above, `client/screens/LabelAnalysisScreen.tsx`, and one new utils module.
- No new mechanisms or abstractions beyond those listed.

## Dependencies

- PR #1993 merged.

## Updates

- 2026-11-23: Done. The whole module moved to `client/lib/label-analysis-utils.ts` (its test to `client/lib/__tests__/`); the screen, both cards and the hook import `@/lib/label-analysis-utils`. Path comments in two server files, one client file and two solution docs were updated to match.
