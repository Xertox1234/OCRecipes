---
title: A hand-duplicated eval-judge context type silently hides new prompt fields from the judge scoring them
track: bug
category: logic-errors
tags: [evals, llm-judge, prompt-engineering, type-drift, coach]
module: server
applies_to: ["evals/**/*.ts", "server/services/nutrition-coach.ts"]
symptoms: ["Personalization eval scores don't move after adding a new context field the model demonstrably uses", "Judge rationales never mention the new field, even on cases built specifically to exercise it", "tsc is silent: the real context type structurally satisfies the judge's wider inline literal"]
created: 2026-07-12
severity: medium
---

# A hand-duplicated eval-judge context type silently hides new prompt fields from the judge scoring them

## Problem

`evals/judge.ts` typed `formatContextSummary`'s parameter as a hand-written inline literal duplicating `CoachContext`'s shape. When PR #579 added `aboutUser` (cooking skill, cuisine prefs, weight→goal) to `CoachContext` and to the system prompt, the eval runner passed the full context to the model — but the judge's summary never rendered `aboutUser`. The dataset case added specifically to score cuisine/skill fit was judged by an LLM that could not see the signal it was scoring.

## Symptoms

- Personalization eval scores don't move after adding a new context field the model demonstrably uses.
- Judge rationales never mention the new field, even on cases built to exercise it.
- No compile error: `CoachContext` structurally satisfies the wider duplicated literal, so `tsc` cannot flag the drift.

## Root Cause

Two renderers of the same data with no shared code or shared type: the prompt builder rendered the new field; the judge's duplicated inline type meant new fields were invisible to it by default. Structural typing makes the duplication *permanently* un-flaggable — the narrower real type always satisfies the wider stale literal.

## Solution

1. Type the judge's parameter as the **real** `CoachContext` (imported), never a duplicated literal — a future field addition that the judge doesn't handle then shows up in review as an obviously-unrendered field.
2. Extract the rendering into one exported helper (`formatAboutUserLines` in `server/services/nutrition-coach.ts`) called by BOTH `buildSystemPrompt` and `formatContextSummary`, so the judge always sees exactly what the model saw.

## Prevention

When adding any field to a prompt-context type that an LLM judge scores against, the same commit must make the judge render it — via the shared renderer, not a copy. Review question: "does `formatContextSummary` show this field?"

## Related Files

- `evals/judge.ts` — judge context summary, now typed as `CoachContext`
- `server/services/nutrition-coach.ts` — `formatAboutUserLines` shared renderer
- `evals/__tests__/judge.test.ts` — pins the rendering

## See Also

- [dead-ui-branch-from-duplicated-context-types](dead-ui-branch-from-duplicated-context-types-2026-05-16.md) — same root pattern: a duplicated context type hiding a field, in a UI branch
