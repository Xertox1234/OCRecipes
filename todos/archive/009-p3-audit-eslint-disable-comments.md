---
title: "Document eslint-disable comments and resolve where possible"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [code-quality, client, tech-debt]
---

# Audit eslint-disable Comments

## Summary

4 `react-hooks/exhaustive-deps` suppressions exist across client screens, but only 1 has an explanatory comment. Review each, add justification comments, and resolve where the suppression can be removed.

## Affected Files

| File | Line | Has Justification? |
|------|------|-------------------|
| `client/screens/ScanScreen.tsx` | 149 | No |
| `client/screens/PhotoAnalysisScreen.tsx` | 439 | No |
| `client/screens/PhotoAnalysisScreen.tsx` | 476 | No |
| `client/screens/meal-plan/RecipeCreateScreen.tsx` | 129 | No |
| `client/components/SkeletonLoader.tsx` | 52 | No |
| `client/components/MealSuggestionsModal.tsx` | 146 | Yes (mutation identity) |

## Acceptance Criteria

- [ ] Each suppression reviewed for necessity
- [ ] Suppressions that can be removed are removed (with proper deps or refactoring)
- [ ] Remaining suppressions have `-- reason` comments explaining why
- [ ] No new `eslint-disable` comments without justification

## Updates

### 2026-02-27
- Initial creation from codebase audit
