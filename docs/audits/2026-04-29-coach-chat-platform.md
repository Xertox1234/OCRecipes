# Audit: Coach Chat Platform

> **Date:** 2026-04-29
> **Trigger:** User-requested audit of the coach chat platform and comparison against common chatbot wrappers
> **Domains:** security, performance, data-integrity, architecture, code-quality, product/UX
> **Baseline:** 4009 tests passing | 0 type errors | 0 lint errors / 26 lint warnings

## Findings

Each finding has a lifecycle: `open` -> `fixing` -> `verified` or `deferred` or `false-positive`.

**Status key:**

- `open` — Found but not yet addressed
- `fixing` — Work in progress
- `verified` — Fix applied AND confirmed by test/grep/type-check
- `deferred` — Intentionally postponed (must link to todo)
- `false-positive` — Agent was wrong or issue was already fixed

### Critical

| ID  | Finding | Domain | Agent | File(s) | Status | Verification |
| --- | ------- | ------ | ----- | ------- | ------ | ------------ |
| —   | —       | —      | —     | —       | —      | —            |

### High

| ID  | Finding                                                                                                                                                                                                                                                                                     | Domain                              | Agent                                   | File(s)                                                                                                                                                       | Status   | Verification                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | Output safety is reactive after streaming has already begun: unsafe dietary advice can be sent in earlier chunks before the periodic/final filter appends a warning; runtime filter also misses diagnosis-style medical claims that are only prompt-prohibited                              | security, AI safety                 | ai-llm-specialist                       | `server/services/nutrition-coach.ts:227`, `server/services/nutrition-coach.ts:330`, `server/lib/ai-safety.ts:91`                                              | verified | Added `containsUnsafeCoachAdvice`/medical-claim detection and buffered coach text until the safety check passes; grep confirmed usage; 58/58 focused safety + nutrition-coach tests pass                                                   |
| H2  | Coach stream failure/cancel/truncation behavior is below mature chat-wrapper expectations: client treats `data.error` as done and drops the optimistic user prompt, server byte-limit breaks without a terminal event, and `handleCoachChat` can persist partial assistant text after abort | product/UX, data-integrity, testing | rn-ui-ux-specialist, testing-specialist | `client/components/coach/CoachChat.tsx:90`, `client/components/coach/CoachChat.tsx:261`, `server/routes/chat.ts:385`, `server/services/coach-pro-chat.ts:407` | verified | Client SSE errors now reject, preserve the prompt, and show `InlineError`; server sends `Response too large` SSE and skips partial persistence on abort/truncation; grep confirmed guards; 70/70 focused chat route + Coach Pro tests pass |
| H3  | Free coach cache can serve stale same-day advice for identical first-turn questions after the user logs food, changes goals/profile data, or asks at a different time; cache key includes a UTC day bucket but not same-day context hash                                                    | data-integrity, AI quality          | database-specialist                     | `server/services/coach-pro-chat.ts:89`, `server/services/coach-pro-chat.ts:321`, `server/storage/chat.ts:413`                                                 | verified | Added `hashCoachCacheContext` for goals, intake, weight trend, dietary profile, and hour bucket; cache key now includes it; grep confirmed usage; 42/42 Coach Pro service tests pass                                                       |
| H4  | Coach meal-plan context can surface cross-user related rows if a corrupted `meal_plan_items` row references another user's recipe/scanned item; base items filter by `userId`, but related fetches use IDs only and schema lacks composite ownership constraints                            | security, data-integrity            | database-specialist                     | `server/storage/meal-plans.ts:493`, `server/storage/meal-plans.ts:524`, `shared/schema.ts:728`                                                                | verified | Related recipe/scanned-item enrichment now filters by `userId`; grep confirmed predicates; corrupted cross-user reference regressions added; 60/60 meal-plan storage tests pass                                                            |

### Medium

| ID  | Finding                                                                                                                                                                                                                                                                         | Domain                   | Agent                                                    | File(s)                                                                                                                                                                                               | Status   | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Coach tools accept raw date strings and unbounded model-selected ranges for daily logs and meal plans, enabling prompt-injected over-fetch and invalid-date behavior; meal-plan tool also returns full related rows rather than a compact context shape                         | security, performance    | ai-llm-specialist, security-auditor, database-specialist | `server/services/coach-tools.ts:62`, `server/services/coach-tools.ts:88`, `server/services/coach-tools.ts:458`, `server/services/coach-tools.ts:515`, `server/storage/meal-plans.ts:500`              | verified | Coach tool schemas now require real ISO dates, meal-plan ranges are capped at 14 days, and meal-plan output is compacted; 15/15 coach-tool tests pass; targeted TS diagnostics clean                                                                                                                                                                                                                                                                                                              |
| M2  | Durable coach memory is not hardened enough for a premium chatbot: notebook extraction lacks the standard system-prompt boundary, extracted memory is not semantically filtered for unsafe goals/medical claims, and notebook delimiter tags are not escaped before reinjection | security, AI memory      | ai-llm-specialist                                        | `server/services/notebook-extraction.ts:16`, `server/services/notebook-extraction.ts:58`, `server/services/notebook-budget.ts:34`, `server/services/coach-pro-chat.ts:271`                            | verified | Extractor prompt now includes the shared system boundary, extracted entries are filtered with coach safety checks before persistence, and notebook delimiters are escaped before reinjection; 14/14 focused notebook tests pass; targeted TS diagnostics clean                                                                                                                                                                                                                                    |
| M3  | Long-horizon commitments can be archived before their follow-up date because archival uses `updatedAt <= cutoff` without preserving active future `followUpDate` commitments                                                                                                    | data-integrity           | database-specialist                                      | `server/storage/coach-notebook.ts:102`, `server/storage/coach-notebook.ts:119`, `server/services/coach-pro-chat.ts:469`                                                                               | verified | Notebook archival now excludes active commitments with future follow-up dates while preserving existing archival behavior for old eligible entries; 20/20 notebook storage tests pass; targeted TS diagnostics clean                                                                                                                                                                                                                                                                              |
| M4  | Tool proposal actions drift from shared block schema and client handlers: tools emit `add_meal_plan`/`add_grocery_list`, schema allows only `log_food`/`navigate`/`set_goal`, and client handles `add_meal_plan` but not `set_goal`/`add_grocery_list`                          | architecture, product/UX | ai-llm-specialist                                        | `server/services/coach-tools.ts:537`, `server/services/coach-tools.ts:552`, `shared/schemas/coach-blocks.ts:43`, `client/components/coach/CoachChat.tsx:293`                                          | verified | Shared action schema now covers meal-plan/grocery actions and GoalSetup navigation, server tool proposals emit schema-aligned action objects, and client handles set_goal/add_grocery_list; 28/28 focused coach-block/tool tests pass; targeted TS diagnostics clean                                                                                                                                                                                                                              |
| M5  | Coach Pro lacks first-class thread history/resume and uses local-only active conversation state; repeated-use behavior is weaker than ChatGPT-style shells where history and thread switching are central                                                                       | product/UX, client-state | rn-ui-ux-specialist                                      | `client/navigation/ChatStackNavigator.tsx:21`, `client/screens/CoachProScreen.tsx:29`, `client/components/coach/CoachChat.tsx:219`                                                                    | verified | Coach Pro now fetches coach conversations, auto-resumes the most recent thread, and exposes accessible New/thread-switch controls above the chat; targeted TS diagnostics clean                                                                                                                                                                                                                                                                                                                   |
| M6  | Message rendering and streaming are not scaled like common wrappers: all messages render in a `ScrollView`, and every streaming chunk triggers state update plus `scrollToEnd` instead of frame-throttled rendering                                                             | performance, product/UX  | rn-ui-ux-specialist                                      | `client/components/coach/CoachChat.tsx:257`, `client/components/coach/CoachChat.tsx:395`, `client/hooks/useChat.ts:155`                                                                               | verified | CoachChat now renders messages via FlatList with stable item keys and throttles streaming text/scroll updates to frame-sized intervals; targeted TS diagnostics clean                                                                                                                                                                                                                                                                                                                             |
| M7  | Coach-specific test/eval coverage misses the riskiest wrapper behaviors: client disconnect/no-persist semantics, SSE timeout/max-byte terminal events, unsafe cache revalidation, notebook side effects, client SSE parser edge states, and Coach Pro tool/memory/block evals   | code-quality, AI quality | testing-specialist, ai-llm-specialist                    | `server/routes/__tests__/chat.test.ts:354`, `server/services/__tests__/coach-pro-chat.test.ts:72`, `client/components/coach/CoachChat.tsx:52`, `evals/runner.ts:5`, `evals/datasets/coach-cases.json` | verified | Added focused regressions for unsafe output fallback, interrupted streams, max-byte SSE terminal errors, abort no-persist, context-aware cache keys, tool date/range validation, compact tool payloads, notebook boundary/filtering/escaping, commitment archival, action schema drift, chat storage ownership, and warm-up hashed keys; expanded coach eval cases across safety, accuracy, helpfulness, personalization, and edge cases; focused suites plus eval dataset schema validation pass |

### Low

| ID  | Finding                                                                                                                                                                                                                         | Domain                    | Agent                                 | File(s)                                                                                                                                      | Status   | Verification                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Assistant/system message persistence is a storage-layer IDOR footgun: `createChatMessage` takes only `conversationId`, accepts arbitrary role strings, and updates conversation timestamp without a user-owned parent predicate | security, architecture    | security-auditor, database-specialist | `server/storage/chat.ts:115`, `shared/schema.ts:912`                                                                                         | verified | `createChatMessage` now requires user ownership, validates role values before insert, and updates the parent conversation through a user-owned predicate; call sites pass authenticated user IDs; 24/24 chat storage tests pass; targeted TS diagnostics clean |
| L2  | Coach logs/cache identifiers expose raw stable IDs in low-level paths (`executeToolCall` debug log and warm-up key construction), whereas nearby notebook logging already hashes user identifiers                               | security, observability   | security-auditor                      | `server/services/coach-tools.ts:417`, `server/services/coach-warm-up.ts:33`                                                                  | verified | Coach tool debug logging now emits `userIdHash`, and warm-up cache keys plus miss/mismatch/expiry logs use hashed user identifiers; 23/23 focused warm-up/tool tests pass; targeted TS diagnostics clean                                                       |
| L3  | Accessibility polish is inconsistent with mature mobile chat shells: Coach Pro composer has 36x36 send/mic controls, input lacks a label, and `ActionCard` exposes a non-pressable container as a button around a nested CTA    | accessibility, product/UX | rn-ui-ux-specialist                   | `client/components/coach/CoachChat.tsx:461`, `client/components/coach/CoachChat.tsx:516`, `client/components/coach/blocks/ActionCard.tsx:14` | verified | Composer send/mic controls now meet 44x44 minimum hit targets, the coach input has an accessibility label, and ActionCard exposes only the actual CTA as a button; targeted TS diagnostics clean                                                               |

## Competitive Benchmark

Overall: OCRecipes Coach Pro is more ambitious than a thin chatbot wrapper. It has domain context, authenticated tools, notebook memory, warm-up for voice, structured blocks, quota gating, SSE streaming, and a real eval harness. Against common wrappers, it is closer to an agentic domain coach than to a generic embedded chat shell.

| Capability              | OCRecipes coach chat                                                                                          | Common chatbot wrapper baseline                                                                                | Audit take                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Domain context          | Strong: goals, intake, weight trend, dietary profile, screen context, Pro notebook                            | Generic wrappers usually pass page/user metadata; domain bots pass richer app state                            | Above baseline, but cache/tool range constraints must keep context fresh and minimal                |
| Tool use                | Strong intent: nutrition lookup, recipe search, daily logs, pantry, meal plan, grocery/substitution proposals | Modern wrappers support tools/actions, but simpler support widgets mostly route/escalate                       | Above generic support widgets; below polished agent wrappers until schema/client drift is closed    |
| Memory                  | Strong concept: notebook entries, follow-up commitments, strategy entries                                     | ChatGPT-style wrappers have thread history; fewer embedded wrappers have durable semantic memory               | Differentiator, but memory hygiene and lifecycle need hardening                                     |
| Streaming UX            | Functional SSE over XHR with optimistic user message and typing state                                         | Mature wrappers provide stop/retry/regenerate, preserve failed prompts, and send deterministic terminal states | Below mature wrappers on failure/cancel semantics                                                   |
| Conversation management | Basic persisted conversations exist, but Coach Pro hides history/resume behind local state                    | ChatGPT-style shells make history/thread switching a first-class surface                                       | Below common long-running chat UX                                                                   |
| Rich UI blocks          | Differentiator: action cards, charts, plans, quick replies                                                    | Common wrappers increasingly support cards/actions, but many remain text-only                                  | Promising, but reliability is hurt by action schema drift and limited eval coverage                 |
| Safety                  | Prompt guidance plus dietary-danger regexes and cache re-scan                                                 | Health/medical-adjacent coaches need fail-closed output checks, refusal metrics, and diagnosis coverage        | Below expectation for a nutrition coach until streaming moderation and medical-claim checks improve |
| Performance scalability | Server has bounded history and tool-call budget; client still renders all messages and updates every chunk    | Mature chat shells virtualize long histories and throttle token rendering                                      | Adequate for short chats, weak for long-term coaching use                                           |
| Tests/evals             | Large suite and initial coach eval dataset                                                                    | Mature wrappers test stream boundaries, cancellation, parser edge cases, tool results, and memory regressions  | Good foundation, but the riskiest agentic paths are under-tested                                    |

## Deferred Items

Items marked `deferred` must have a linked todo and rationale.

| ID  | Todo | Rationale |
| --- | ---- | --------- |
| —   | —    | —         |

## Summary

| Severity  | Found | Verified | Deferred | False-positive | Open  |
| --------- | ----- | -------- | -------- | -------------- | ----- |
| Critical  | 0     | 0        | 0        | 0              | 0     |
| High      | 4     | 4        | 0        | 0              | 0     |
| Medium    | 7     | 7        | 0        | 0              | 0     |
| Low       | 3     | 3        | 0        | 0              | 0     |
| **Total** | 14    | 14       | 0        | 0              | **0** |

## Fix Commits

| Commit | Description |
| ------ | ----------- |
| —      | —           |

## Codification (Phase 7)

Completed after fixes are committed. Each row links to the docs change.

### Patterns Extracted

| Finding | Pattern | Added To |
| ------- | ------- | -------- |
| —       | —       | —        |

### Learnings Extracted

| Finding | Learning Title | Category |
| ------- | -------------- | -------- |
| —       | —              | —        |

### Code Reviewer Updates

| Finding | New Check Added |
| ------- | --------------- |
| —       | —               |

### Specialist Agent Updates

| Finding | Agent Updated | New Check Added |
| ------- | ------------- | --------------- |
| —       | —             | —               |

**Codification commit:** `pending`

## Post-Audit Notes

- Baseline lint warning count includes warnings under `.claude/worktrees/` plus current workspace warnings.
- Deduped older/fixed variants from recent audits, including Coach Pro/non-Pro cache mixing, cache re-scan, warm-up type guard, direct `_internals` use, and `getChatMessages` optional ownership.
- All 14 findings are fixed and verified in this working tree; no commit has been created.
- `evals/datasets/coach-cases.json` is included intentionally as the M7 eval-coverage follow-up and validates via `evals/__tests__/types.test.ts`.
