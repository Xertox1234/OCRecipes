---
title: "Split handleCoachChat into load / stream / finalize stages chosen by tier"
status: done
priority: high
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, server, coach]
github_issue:
---

# Split handleCoachChat into load / stream / finalize stages chosen by tier

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`handleCoachChat` in `server/services/coach-pro-chat.ts:516-1033` is one ~520-line async generator: finder early-return, a seven-way `Promise.all`, warm-up consume, token truncation, cache check/replay, pro-vs-free stream loop, safety re-scan, block parse + write-card build, offer delivery, cache write and notebook extraction. `isCoachPro` is checked 16 times (`grep -c isCoachPro`), incl. three `isCoachPro ? storage.x(...) : Promise.resolve([] as Awaited<ReturnType<…>>)` cast ternaries (~`:624-640`). The 2026-10-26 decomposition took it 1169 → 1033 but left this body whole.

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [x] A `proOnly(isCoachPro, () => fetch, empty)` helper replaces the three cast ternaries
- [x] Stages `loadTurnContext`, `streamReply` (cached replay kept as its own small generator) and `finalizeTurn` take and return plain data
- [x] The tier picks which stages run; per-line `isCoachPro` checks drop to the stage selection
- [x] `coach-pro-chat.ts` under 600 lines; streamed event order, cache keys and quota/refund behaviour unchanged (existing tests green)

## Implementation Notes

- Tests mock `generateCoachResponse` positionally (`mock.calls[0][5]`; `toHaveLength(5)` in `coach-recipe-offer-acceptance.test.ts`) — keep call signatures.
- Safety re-scan must stay after the stream and before any persistence.
- Review: server-reviewer + ai-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** server/services/coach-pro-chat.ts, server/services/coach-pro-chat/\*_, server/services/**tests**/coach-pro-chat_.test.ts
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).

### 2026-11-21

- Done: handleCoachChat is now a 126-line orchestrator over finder-gate, loadTurnContext, streamReply (cached replay / Pro / free generators, safety re-scan last) and finalizeTurn, in server/services/coach-pro-chat/. proOnly replaces the three cast ternaries.
- Criterion 4 evidence: `wc -l server/services/coach-pro-chat.ts` = 126; existing suites (coach-pro-chat, write-cards, offer-acceptance, nutrition-coach, chat route) pass unchanged.
