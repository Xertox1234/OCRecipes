---
title: "Document photo analysis pipeline in project docs"
status: done
priority: medium
created: 2026-02-08
updated: 2026-02-08
completed: 2026-02-08
assignee:
labels: [documentation, photo-analysis]
---

# Document Photo Analysis Pipeline

## Summary

The photo analysis feature (OpenAI Vision-based food recognition) is undocumented. Explore the full pipeline and add documentation to all relevant doc files.

## Background

The app can analyze food photos using OpenAI's Vision API, detect preparation methods, assign confidence scores, and support follow-up questions. None of this is documented.

## Acceptance Criteria

- [x] Document PhotoIntentScreen and PhotoAnalysisScreen in FRONTEND.md
- [x] Document /api/photos/\* endpoints (analyze, followup, confirm) in API.md
- [x] Document server/services/photo-analysis.ts in ARCHITECTURE.md
- [x] Document scannedItems photo-related columns (sourceType, photoUrl, aiConfidence, preparationMethods, analysisIntent) in DATABASE.md
- [x] Add photo analysis to CLAUDE.md AI integration section

## Implementation Notes

Key files to explore:

- `client/screens/PhotoIntentScreen.tsx` — intent selection (nutrition info, recipe ideas, etc.)
- `client/screens/PhotoAnalysisScreen.tsx` — analysis results with follow-up
- `server/services/photo-analysis.ts` — OpenAI Vision integration
- `server/routes.ts` — search for /api/photos endpoints
