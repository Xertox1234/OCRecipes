---
title: "Zero test coverage on all new features (phases 0-11)"
status: backlog
priority: high
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [testing, code-review, quality]
---

# Zero Test Coverage on New Features

## Summary

The ~18K-line feature addition (fasting, medication, exercises, weight, chat, adaptive goals, HealthKit, micronutrients, food NLP, voice, menu scanning) has zero test coverage.

## Background

Test infrastructure exists (Vitest, pre-commit hooks). Older features (auth, storage, photo-analysis, recipes, subscriptions) have tests. But all 12+ new services, 10+ new hooks, and 10+ new route files are completely untested. Found by pattern-recognition agent.

## Acceptance Criteria

- [ ] Unit tests for new services: fasting-stats, exercise-calorie, weight-trend, food-nlp, menu-analysis, micronutrient-lookup, nutrition-coach, adaptive-goals
- [ ] Route validation tests for new endpoints
- [ ] Hook tests for client-side data fetching
- [ ] Pre-commit hooks continue to pass

## Updates

### 2026-02-24
- Found by pattern-recognition agent
