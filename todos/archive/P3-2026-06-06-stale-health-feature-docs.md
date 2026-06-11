---
title: "Update docs that still reference removed health features"
status: done
priority: low
created: 2026-06-06
updated: 2026-06-06
assignee:
labels: [deferred, documentation]
github_issue:
---

# Update docs that still reference removed health features

## Summary

PR #384 removed weight/fasting/HealthKit/GLP-1/adaptive-goals but several tracked
docs still describe those modules as if they exist. Refresh them.

## Background

The removal intentionally scoped to code + DB tables, not docs, to keep the PR
focused. As a result some tracked docs and agent definitions now reference deleted
files (e.g. `server/services/adaptive-goals.ts`, `useFasting.ts`). These are not
CI-checked, so they did not block the merge, but they give stale guidance to
Copilot, the subagents, and human readers.

## Acceptance Criteria

- [ ] `.claude/agents/nutrition-domain-expert.md` — remove the Adaptive Goals / Weight Trend / Fasting Statistics sections and their file references.
- [ ] `.claude/agents/database-specialist.md`, `architecture-specialist.md`, `security-auditor.md` — remove the `weightLogs`/`fastingLogs`/`healthKitSync`/`medicationLogs`/`goalAdjustmentLogs` examples and `endFastingLog`/`getFastingSchedule` snippets.
- [ ] `docs/FRONTEND.md` — remove the `useMedication`/`useWeightLogs`/`useFasting`/`useHealthKit` hook entries and the `HealthKitSyncIndicator`/`MedicationLogCard` component entries.
- [ ] `docs/ROADMAP.md` — remove the "Apple HealthKit Sync" and "Fasting Tracking" feature entries.
- [ ] Do NOT edit `docs/legacy-patterns/*` (frozen archive — intentionally historical).

## Implementation Notes

- Pure doc edits; no code/test impact.
- Confirm with: `grep -rniE "weightLog|fasting|healthKit|glp1|adaptive-goals|medicationLog" .claude/agents docs/FRONTEND.md docs/ROADMAP.md` returns nothing meaningful afterward.

## Dependencies

- None (PR #384 merged).

## Risks

- Low — documentation only.

## Updates

### 2026-06-06

- Initial creation — deferred from #384 (scope was code + tables, not docs).
