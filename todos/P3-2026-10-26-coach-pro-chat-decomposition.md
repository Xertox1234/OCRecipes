---
title: "Shrink coach-pro-chat's handleCoachChat and settle its tier-config layer"
status: in-progress
priority: low
created: 2026-10-26
updated: 2026-10-26
assignee:
labels: [deferred, maintainability, server, ai]
github_issue:
---

# Shrink coach-pro-chat's handleCoachChat and settle its tier-config layer

## Summary

`handleCoachChat` is ~505 lines; pick one tier mechanism and move context assembly, notebook extraction and cache-key helpers out.

## Background

Audit finding L2. `server/services/coach-pro-chat.ts`: `CoachTierConfig` (`:516-522`, built `:684-689`) — five flags all `isCoachPro`/`!isCoachPro` — was introduced to replace scattered checks, yet `isCoachPro` is still tested directly (e.g. `:708`), so both mechanisms coexist. Context assembly (~110 lines), notebook extraction closure (~65) and hash/cache-key helpers (`:257-440`, ~190) are separable. `nutrition-coach.ts` generators share an identical sanitize prologue.

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [ ] One tier mechanism: either delete `CoachTierConfig` and use `isCoachPro`, or route every remaining check through it
- [ ] `buildCoachContext()`, `extractAndStoreNotebook()` extracted; hash/cache-key helpers move to `server/services/coach-cache-keys.ts` (re-export what tests import)
- [ ] `prepareCoachMessages()` shared by both generators in `nutrition-coach.ts`
- [ ] coach-pro-chat.ts under ~800 lines
- [ ] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [ ] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Prompt text and sanitization order must not change — `ai-reviewer` reviews. Cache keys must hash identically (pin with a test comparing a fixed input's key before/after).

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `server/services/coach-pro-chat.ts`, `server/services/nutrition-coach.ts`, new `server/services/coach-cache-keys.ts`, their `__tests__`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A changed cache-key hash silently invalidates or cross-serves cached coach replies.

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit
