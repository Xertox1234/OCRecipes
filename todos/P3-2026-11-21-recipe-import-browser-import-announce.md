---
title: "Announce the Import press in the recipe import browser"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Announce the Import press in the recipe import browser

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/screens/meal-plan/RecipeImportBrowserScreen.tsx:107-117, 350-378`: pressing Import swaps the label for a spinner with no announce on either platform, and the footer's polite live region wraps a Pressable (Android re-reads the subtree).

## Acceptance Criteria

- [ ] "Importing recipe" is announced when importing starts
- [ ] The live region covers only the status text, not the button

## Implementation Notes

Files: `client/screens/meal-plan/RecipeImportBrowserScreen.tsx` and its test.

## Updates

### 2026-11-21

- Filed from the accessibility audit
