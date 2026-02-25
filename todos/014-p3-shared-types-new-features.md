---
title: "Create shared types for new features (fasting, medication, exercise, weight)"
status: backlog
priority: low
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [refactor, code-review, types]
---

# Create Shared Types for New Features

## Summary

Client hooks (useFasting, useMedication, useExerciseLogs, useWeightLogs) re-declare types locally instead of importing from shared. The older features properly use shared types.

## Acceptance Criteria

- [ ] Shared type files for fasting, medication, exercise, weight in shared/types/
- [ ] Client hooks import from shared instead of re-declaring
- [ ] No duplicate type definitions

## Updates

### 2026-02-24
- Found by pattern-recognition and architecture agents
