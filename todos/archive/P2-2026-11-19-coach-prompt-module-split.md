---
title: "Move coach prompt building out of nutrition-coach.ts into coach-prompt.ts"
status: done
priority: medium
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, server, coach]
github_issue:
---

# Move coach prompt building out of nutrition-coach.ts into coach-prompt.ts

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`server/services/nutrition-coach.ts` (944 → 1048) holds two modules: prompt building (`:29-590` — `formatAboutUserLines`, `buildIntentBlock`, `buildSystemPrompt`, template-version hash) and the stream generators (`:596-1048` — `generateCoachResponse`, `generateCoachProResponse`). Importers: `coach-pro-chat.ts`, `coach-cache-keys.ts`, `coach-context-builder.ts` (type-only). Both generators also repeat the same abort-vs-error catch (~4 copies).

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [x] `server/services/coach-prompt.ts` owns the prompt half plus `CoachContext` / `CoachAllergy`; importers import from the defining module (no re-export barrel)
- [x] `nutrition-coach.ts` keeps only the generators and is under 600 lines
- [ ] Optional: `classifyStreamFailure(abortSignal, error, log, tag)` collapses the repeated catch blocks
- [x] Prompt text and template-version hash byte-identical (pin with a test)

## Implementation Notes

- The template-version hash feeds coach cache keys — any byte change invalidates caches; assert it is unchanged.
- Review: ai-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** server/services/nutrition-coach.ts, server/services/coach-prompt.ts, server/services/coach-pro-chat.ts, server/services/coach-cache-keys.ts, server/services/coach-context-builder.ts, related tests
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-21

- Criterion 3 not met: optional classifyStreamFailure left out; out of scope for a pure move.
- Criterion 4 evidence: server/services/**tests**/coach-prompt.test.ts pins hash b28e7ee438e62ac8, taken before the move.
- Importers outside the contract list (evals/\*, scripts/probe-offer-recipe.ts, tests) repointed to coach-prompt for criterion 1.

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).
