---
title: "Sanitize AI prompt inputs in suggestions route"
status: backlog
priority: high
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [security, ai, audit-2026-03-27-full]
audit_id: H1
---

# Sanitize AI prompt inputs in suggestions route

## Summary

`server/routes/suggestions.ts:104` interpolates `item.productName` and `item.brandName` from the database directly into an AI prompt without `sanitizeUserInput()` or `SYSTEM_PROMPT_BOUNDARY`. This enables indirect prompt injection via crafted product names.

## Background

Other AI routes (`nutrition-coach.ts`, `food-nlp.ts`) correctly sanitize user input before prompt interpolation. The suggestions route was missed. An attacker who scans or creates an item with a crafted `productName` (e.g., "ignore previous instructions...") can achieve indirect prompt injection when suggestions are later generated.

## Acceptance Criteria

- [ ] `sanitizeUserInput()` applied to `item.productName` and `item.brandName` before interpolation
- [ ] `SYSTEM_PROMPT_BOUNDARY` added to the system message
- [ ] Existing tests pass
- [ ] New test case covers sanitized input

## Implementation Notes

- Import `sanitizeUserInput` from `server/services/ai-sanitization` (or wherever it's defined)
- Follow the same pattern used in `nutrition-coach.ts:77` and `food-nlp.ts:42`

## Dependencies

- None

## Risks

- None — straightforward addition

## Updates

### 2026-03-27

- Created from full audit finding H1
