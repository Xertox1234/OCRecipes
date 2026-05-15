---
title: "Sanitize AI prompt inputs in recipe generation"
status: backlog
priority: high
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [security, ai, audit-2026-03-27-full]
audit_id: H2
---

# Sanitize AI prompt inputs in recipe generation

## Summary

`server/services/recipe-generation.ts:124` interpolates `input.productName` directly into an AI prompt without `sanitizeUserInput()` or `SYSTEM_PROMPT_BOUNDARY`. Same indirect prompt injection risk as H1.

## Background

Same class of vulnerability as the suggestions route (H1). The product name originates from user input and is stored in the database, then later used unsanitized in an AI prompt.

## Acceptance Criteria

- [ ] `sanitizeUserInput()` applied to `input.productName` before interpolation
- [ ] `SYSTEM_PROMPT_BOUNDARY` added to the system message
- [ ] Existing tests pass

## Implementation Notes

- Same pattern as H1 fix
- Check for any other `input.*` fields interpolated into prompts in this file

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding H2
