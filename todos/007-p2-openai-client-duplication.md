---
title: "OpenAI client instantiated 9 times across services"
status: backlog
priority: high
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [architecture, code-review, dry]
---

# OpenAI Client Duplicated 9 Times

## Summary

Nine separate files create their own `new OpenAI()` instance with the same config. If the API key env var changes, 9 files need updating.

## Background

Files with duplicate instances: photo-analysis.ts, meal-suggestions.ts, nutrition-coach.ts, menu-analysis.ts, recipe-generation.ts (2x), food-nlp.ts, voice-transcription.ts, _helpers.ts. The _helpers.ts exports an openai instance that NO service imports.

## Acceptance Criteria

- [ ] Single OpenAI client in `server/lib/openai.ts`
- [ ] All 9 files import from the shared module
- [ ] Unused export in `_helpers.ts` removed
- [ ] Tests pass

## Updates

### 2026-02-24
- Found by architecture-strategist agent
