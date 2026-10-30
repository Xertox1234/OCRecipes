---
title: "Cap paid AI calls in the database before they run — recipe auto-images, front-label vision, premium AI endpoints"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, security, ai]
github_issue:
---

# Cap paid AI calls in the database before they run — recipe auto-images, front-label vision, premium AI endpoints

## Summary

Several paid AI calls are bounded only by per-minute in-memory rate limiters (reset on every deploy), and one checks its per-user cap after the paid call.

## Background

Audit findings M-sec-2, M-sec-3, M-sec-6. (1) `POST /api/meal-plan/recipes` and `POST /api/meal-plan/items` with an inline recipe fire `generateRecipeImage` (Runware + art-director LLM) for every recipe without an image, for free users too — about 43k images/day per account at 30/min. (2) `POST /api/verification/front-label` runs `analyzeFrontLabel` (vision) before `frontLabelStore.createIfAllowed`, so a rejected request has already paid; no daily cap. (3) Premium menu scan, food voice transcription, cookbook cover generation, recipe-chat upload-image and suggestions have no DB daily cap. The cap VALUES are a pricing decision for the owner.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] Owner picks the free-tier policy for recipe auto-images (premium-only, a daily count, or a placeholder) and the daily caps per premium feature
- [ ] Each listed call checks a DB-backed per-user count BEFORE the paid call, and counts the call atomically (pattern: `getDailyRecipeGenerationCount` / `logRecipeGenerationWithLimitCheck`)
- [ ] front-label checks its cap (or the shared daily scan count) before `analyzeFrontLabel`
- [ ] Route tests call each endpoint N+1 times and assert the (N+1)th is refused without calling the AI service

## Implementation Notes

Follow `docs/solutions/conventions/security-caps-must-be-durable-and-say-which-window-2026-10-03.md` and `docs/solutions/conventions/replacing-a-capped-paid-call-must-carry-its-cap-2026-10-13.md`.

## Scope Contract

- **Files in scope:** `server/routes/meal-plan.ts`, `server/routes/verification.ts`, `server/routes/menu.ts`, `server/routes/food.ts`, `server/routes/cookbooks.ts`, `server/routes/recipe-chat.ts`, `server/routes/suggestions.ts`, the matching `server/storage/*` count functions and their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
