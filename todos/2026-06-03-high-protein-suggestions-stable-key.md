---
title: "Use stable key for HighProteinSuggestions list items instead of suggestion.title"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Use stable key for HighProteinSuggestions list items instead of suggestion.title

## Summary

`HighProteinSuggestions.tsx:46` uses `suggestion.title` as React list `key` — not guaranteed unique if the AI returns two suggestions with the same title.

## Background

Deferred from 2026-06-03 full audit (L20). File: `client/components/HighProteinSuggestions.tsx:46`.

## Acceptance Criteria

- [ ] List key is stable and unique — either `suggestion.id` (if available from the API), or `index` as a fallback (acceptable for static AI-generated lists), or `${suggestion.title}-${index}` to prevent collisions

## Implementation Notes

If `suggestion` has an `id` field from the API response, use that. Otherwise `key={index}` is acceptable here since the list is AI-generated and not reordered. Using both `${title}-${index}` is safe even without an id.

## Dependencies

- None

## Risks

- None — key change is invisible to users

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L20)
