---
title: "Move LabelAnalysisScreen's upload/AI-reconcile state into useLabelAnalysisSession"
status: done
priority: medium
created: 2026-11-19
updated: 2026-11-22
assignee:
labels: [deferred, maintainability, client, camera]
github_issue:
---

# Move LabelAnalysisScreen's upload/AI-reconcile state into useLabelAnalysisSession

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`client/screens/LabelAnalysisScreen.tsx` (1008 lines) holds 13 `useState`s, refs and an ~85-line upload effect (`:215-300`) that reconciles the local preview with the AI result (`dataSourceRef`, `labelDataRef`, `shouldReplaceWithAI`, toast timer, retry token).

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [x] `useLabelAnalysisSession({ imageUri, barcode, localPreview })` returns `{ sessionId, labelData, dataSource, isAnalyzing, error, uploadFailed, showUpdatedToast, retry }`
- [x] The dataSource × labelData reconciliation is one reducer with Vitest cases
- [x] The merged a11y announcer effect (`:166-205`) is kept intact as one effect (its comment explains why)
- [x] Screen under 750 lines; no visible or VoiceOver change

## Implementation Notes

- iOS announcement timing is fragile — do not split the announcer effect.
- Review: mobile-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** client/screens/LabelAnalysisScreen.tsx, client/hooks/useLabelAnalysisSession.ts, related tests
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).

### 2026-11-22

- Done: `useLabelAnalysisSession` hook + `labelSessionReducer` (12 Vitest cases in label-analysis-utils.test.ts, three of them from the review fixes); announcer effect kept as one effect. The screen needed the serving and nutrition-facts cards extracted (LabelServingsCard, LabelNutritionFactsCard) to get under 750 lines (1013 → 698) — beyond the scope contract's file list, same extract-component pattern.
