---
title: "Turn coach-tools into a tool registry so 'offered' and 'executable' are one rule"
status: done
priority: high
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, server, coach]
github_issue:
---

# Turn coach-tools into a tool registry so 'offered' and 'executable' are one rule

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`server/services/coach-tools.ts` grew 756 → 1336 lines since 2026-10-25. Tool availability is decided twice: `getToolDefinitions` (`:367-384`) filters by `opts.writeCards` / `opts.pantryCard`, and `executeToolCall` (`:962-1336`) re-checks the same flags as `Unknown tool` throws in the `update_pantry` (`:1205`), `get_my_recipes` (`:1285`) and `find_plan_recipes` (`:1307`) cases. Definitions (`baseToolDefinitions`, `:386-860`), arg schemas (`:77-190`) and handlers are three separate places per tool.

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [x] Each tool is one registry entry `{ name, definition, argsSchema, available(opts), run(args, ctx) }`
- [x] `getToolDefinitions` = `entries.filter(available).map(definition)`; `executeToolCall` = find → `available` → `safeParse` → `run` — the availability rule exists once
- [x] Entries split across `server/services/coach-tools/{nutrition,recipes,pantry,grocery,plan}.ts`; `coach-tools.ts` under 600 lines
- [x] `groceryCardResult` / `pantryCardResult` (`:876-930`) live beside `server/services/write-cards/`
- [x] Tool names, wire JSON schemas, error copy and `Unknown tool` messages unchanged (existing tests stay green unmodified)

## Implementation Notes

- The dead positional `_preloadedProfile` param is pinned by tests by index (`mock.calls[0][5]`) — convert positional args to an options object in a SEPARATE commit, updating those tests.
- Write-card variants swap the definition of `log_food_item`, `add_to_meal_plan`, `add_to_grocery_list` (`WRITE_CARD_TOOL_DEFINITIONS`); model the variant as `definition(opts)` on the entry, not a second entry.
- Review: server-reviewer + ai-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** server/services/coach-tools.ts, server/services/coach-tools/\*_, server/services/**tests**/coach-tools_.test.ts
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).

### 2026-11-19 (implemented)

- Registry in `server/services/coach-tools/{types,nutrition,recipes,pantry,grocery,plan}.ts`; `coach-tools.ts` is 145 lines; card results in `server/services/write-cards/results.ts`.
- Not done: converting `executeToolCall`'s positional args to an options object (the Implementation Notes' separate commit). It touches `nutrition-coach.ts` callers and index-pinned tests, outside the Scope Contract and the acceptance criteria; left as a follow-up.
- Criterion 5 evidence: `getToolDefinitions` JSON compared to the pre-refactor output for all four `{writeCards, pantryCard}` combinations (identical); existing tests pass unmodified; `server/services/__tests__/coach-tools-registry.test.ts` pins offered == executable.
