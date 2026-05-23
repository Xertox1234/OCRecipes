---
title: "Coerce pantry item.quantity before interpolating into the meal-plan prompt"
status: backlog
priority: low
created: 2026-05-22
updated: 2026-05-22
assignee:
labels: [deferred, security, ai-prompting]
github_issue:
---

# Coerce pantry item.quantity before interpolating into the meal-plan prompt

## Summary

`server/services/pantry-meal-plan.ts:144` interpolates `item.quantity` into the LLM prompt without sanitization or numeric coercion, while the sibling fields (`item.name`, `item.unit`, `item.category`) are all passed through `sanitizeUserInput`. Make the safety invariant self-evident rather than dependent on the column type.

## Background

Surfaced by the security-auditor during the 2026-05-22 security audit (finding L3, deferred). **Not exploitable today**: `pantry_items.quantity` is a Drizzle `decimal` column (`shared/schema.ts`), so the value is a numeric string and cannot carry an injection payload. The footgun is latent — it becomes a real prompt-injection gap only if a future migration loosens that column to free `text`.

The closely-related prior finding (pantry `unit`/`category` unsanitized, 2026-05-20 L1) was already fixed; its todo is archived at `todos/archive/2026-05-20-sanitize-pantry-unit-category-prompt.md`. This todo covers only the remaining `quantity` field.

## Acceptance Criteria

- [ ] `item.quantity` is coerced/validated before interpolation at `server/services/pantry-meal-plan.ts:144` — e.g. wrap in `Number(item.quantity)` (guarding `NaN`) or route through `sanitizeUserInput`
- [ ] Behavior unchanged for valid numeric quantities (existing pantry-meal-plan tests still pass)
- [ ] The fix makes the "quantity cannot inject" invariant explicit in code, not reliant on the schema column type

## Implementation Notes

- File in scope: `server/services/pantry-meal-plan.ts` (the `buildPantryList`/prompt-construction map around line 141-148).
- Prefer `Number(item.quantity)` coercion (with a `Number.isFinite` guard, falling back to the raw trimmed value or empty) so the prompt always sees a numeric token; `sanitizeUserInput(String(item.quantity))` is an acceptable alternative for consistency with the sibling fields.
- Keep it a one-line surgical change — do not refactor the surrounding prompt builder.

## Risks

- None of substance; not exploitable under the current schema. Lowest-priority hardening.

## Updates

### 2026-05-22

- Created as a deferred (L3) item from the 2026-05-22 security audit. See `docs/audits/2026-05-22-security.md`.
