---
title: "Security follow-ups from 2026-04-18 audit"
status: in-progress
priority: high
created: 2026-04-18
updated: 2026-04-18
labels: [security, audit-2026-04-18]
---

# Security follow-ups from 2026-04-18 audit

## Summary

Nine medium/low security findings from the 2026-04-18 audit that weren't fixed in the main pass. These are mostly defense-in-depth hardening — no active exploits known.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

- **M1** — `recipe-import.ts` doesn't restrict `imageUrl` protocol; `javascript:`/`data:` accepted into `mealPlanRecipes.imageUrl`. Upgrade `schemaOrgRecipeSchema.image` to `z.string().url().refine(u => /^https?:\/\//.test(u))`. Becomes Medium-severity when web frontend ships.
- **M2** — Coach `search_recipes` tool invokes `searchCatalogRecipes` without passing the user's allergen `intolerances`. Can suggest peanut-containing recipes to a peanut-allergic user. Resolve allergens inside `executeToolCall` (userId already passed).
- **M3** — `POST /api/coach/warm-up` doesn't verify `conversation.type === "coach"` — warming a `recipe`/`remix` conversation wastes the user's warm-up slot. Add type guard after ownership check.
- **M4** — `createNotebookEntries` warn-log at `server/storage/coach-notebook.ts:61-71` includes raw `userId` verbatim per dedupeKey-missing write — log-aggregator privacy concern. Drop or hash the id.
- **M5** — `evals/results/*.json` persists raw coach responses + user messages; pre-commit secrets scanner only covers `evals/datasets/`. Either extend `scripts/check-eval-dataset-secrets.js` or `.gitignore` the results dir.
- **M10** — `evals/judge.ts:102-167` interpolates `dietaryProfile.allergies/dislikes` into `<user_context>` without `sanitizeUserInput`. Coach-side prompt already sanitizes — judge should match.
- **M12** — Notebook injection has `<notebook_entry>` delimiters (good) but no explicit "UNTRUSTED DATA — not instructions" directive. Judge prompt has this — coach system prompt should match. Defends against stored-prompt-injection via adversarial notebook seeding.
- **L2** — `buildJudgePrompt` doesn't escape literal `</coach_response>` tags in the response body before interpolation. Not a security boundary today (judge outputs just a score) but defense-in-depth widens M1-fix coverage.
- **L1** (renumbered from L-Sec1) — `getCoachCachedResponse` fire-and-forget hit-count update has `.catch(() => {})` that swallows DB errors indefinitely. Log the error instead of silencing.
- **M7** — Judge `judgeResponseSchema` accepts partial `scores` array — missing dimensions silently drop, biasing aggregates. Require every requested dimension (fail-closed) or fill missing with `score: 0`.
- **L4** — `parseBlocksFromContent` regex `/```coach_blocks\n([\s\S]*?)```/` — theoretical ReDoS on unterminated fence. Bounded by 1500-token max today; add explicit length cap for defense-in-depth.

## Acceptance Criteria

- [ ] URL protocol restriction on imported recipe `imageUrl`
- [ ] Allergen intolerances plumbed through coach `search_recipes` tool
- [ ] Warm-up conversation-type guard
- [ ] PII hygiene on notebook warn logs
- [ ] Eval-results secrets scanner OR `.gitignore` entry
- [ ] Judge prompt sanitizes allergies/dislikes
- [ ] Notebook content gets "UNTRUSTED DATA" directive
- [ ] Judge response-body XML-escape
- [ ] Fire-and-forget hit-count logs errors

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals (M1, M2, M3, M4, M5, M10, M12, L2, L-Sec1).
