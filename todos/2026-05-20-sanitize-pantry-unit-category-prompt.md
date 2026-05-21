---
title: "Sanitize pantry unit/category before LLM prompt interpolation"
status: backlog
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, security, ai-prompting]
github_issue:
---

# Sanitize pantry unit/category before LLM prompt interpolation

## Summary

`formatPantryItems` in `server/services/pantry-meal-plan.ts` sanitizes only
`item.name` before interpolating it into the meal-plan LLM prompt; the free-text
`item.unit` and `item.category` fields are concatenated raw. Wrap them in
`sanitizeUserInput` to satisfy the "sanitize ALL user-sourced strings before
prompt interpolation" rule.

## Background

Found in the 2026-05-20 security audit (L1). `POST /api/pantry` validates `unit`
and `category` as `z.string().max(50)` (see `server/routes/pantry.ts` lines
19-20) — both free-text user input with no enum restriction. In
`server/services/pantry-meal-plan.ts` lines 143-146 `item.unit` and
`item.category` are appended raw while `item.name` is sanitized. `item.quantity`
is a numeric `decimal` — not an injection vector. This is self-injection
(the user can only inject into their own coach context), bounded by
`SYSTEM_PROMPT_BOUNDARY` and the 50-char limits, so it is low-severity — but it
violates the hard rule in `docs/rules/security.md`.

## Acceptance Criteria

- [ ] `item.unit` wrapped in `sanitizeUserInput()` before interpolation
- [ ] `item.category` wrapped in `sanitizeUserInput()` before interpolation
- [ ] `server/services/__tests__/pantry-meal-plan.test.ts` still passes

## Implementation Notes

File: `server/services/pantry-meal-plan.ts`, `formatPantryItems`.
`sanitizeUserInput` is already imported. Leave `item.quantity` as-is (numeric).

## Risks

- None significant — additive sanitization on already-bounded fields.

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, finding L1).
