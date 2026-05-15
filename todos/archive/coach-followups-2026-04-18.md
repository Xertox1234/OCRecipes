---
title: "Coach Pro / chat DB follow-ups from 2026-04-18 audit"
status: done
priority: high
created: 2026-04-18
updated: 2026-04-18
labels: [coach, ai-llm, database, audit-2026-04-18]
---

# Coach Pro / chat DB follow-ups from 2026-04-18 audit

## Summary

Twelve findings spanning coach correctness, DB hygiene, and chat IDOR. Main-pass fixes in this audit handled the highest-impact items (cache key scoping, tool-call budget closure) — this todo covers the residual hardening.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

### Coach correctness

- **M6** — Cached coach responses replay without re-running `containsDangerousDietaryAdvice` — tightened patterns don't invalidate for up to 7d. Re-scan on cache hit, or invalidate on pattern-version bump.
- **M8** — Client-disconnect sets `aborted=true` but doesn't call `stream.controller.abort()` — OpenAI continues generating + billing. Pass `{ signal: abortController.signal }` to `openai.chat.completions.create` and abort on `req.on("close")`.
- **M9** — `shouldUpdateStrategy(0)` returns `false` — self-locking gate: new users never get `coaching_strategy` extracted. Change to `count === 0 || count % 5 === 0`.
- **M11** — Coach tool args parsed with `JSON.parse` then passed as `Record<string, unknown>` to `executeToolCall` with no Zod validation; `log_food_item` handler reads `mealType`/`description` not declared in tool schema (phantom params, always undefined). Add per-tool Zod schemas; handler-schema alignment.
- **M40** — `coach-pro-chat.ts:205-208` plumbs `profile.allergies`/`foodDislikes` into `CoachContext` without `sanitizeContextField` — inconsistent with notebook sanitization at line 219.

### Chat storage hardening

- **M13** — `saveRecipeFromChat` casts safeParse result back to `Record<string, unknown>`, reads `rawMetadata.savedRecipeId`, `Number()`-coerces (→ NaN/0), no `authorId`/`isPublic` filter. Use `parsed.data.savedRecipeId` and add ownership filter.
- **M14** — `getChatConversations` sorts `updatedAt DESC` + filters `userId` with no composite index. Add `(userId, updatedAt DESC)` composite.
- **M15** — `createChatMessageWithLimitCheck` runs two independent count queries serially inside advisory-lock tx. `Promise.all` halves lock-hold time.
- **M16** — `coach_notebook.dedupeKey` unique index is nullable + not partitioned by `status`. NULL-distinct means `onConflictDoNothing` doesn't dedup NULL-keyed rows; archived identical entries re-blocked after 30d. Add `WHERE dedupe_key IS NOT NULL AND status = 'active'` partial index; backfill + `NOT NULL`.
- **M17** — `deleteUser` purges community recipes in tx but doesn't call `removeFromIndex` → deleted recipes keep surfacing in search until restart. Mirrors H6 pattern from 2026-04-17.
- **L19** — `CookSessionCaptureScreen` sets `isActive={false}` during analyzing → preview freezes behind spinner overlay. Keep preview active, gate capture only.
- **L20** — `useScanClassification.isClassifyingRef` not reset on blur — in-flight upload can navigate user from a different screen. Add `isFocused` guard or abort signal.

## Acceptance Criteria

- [x] Cached responses re-scanned for dangerous advice
- [x] OpenAI stream aborts on client disconnect
- [x] `shouldUpdateStrategy` returns true for count === 0
- [x] Tool args Zod-validated; handler-schema alignment
- [x] Allergens/dislikes sanitized at coach-context boundary
- [x] `saveRecipeFromChat` typed access + ownership filter
- [x] `(userId, updatedAt DESC)` composite index on `chat_conversations`
- [x] Parallel count queries in `createChatMessageWithLimitCheck`
- [x] Partial unique index on `coach_notebook.dedupeKey`
- [x] `deleteUser` calls `removeFromIndex` for purged community recipes
- [x] CookSession preview stays live during analysis
- [x] `useScanClassification` aborts on blur

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals.

### 2026-04-18 (completed)

- All 12 acceptance criteria implemented and verified.
- 267 tests passing, TypeScript clean.
- Patterns codified: SSE AbortController / OpenAI stream cancellation, cache safety re-scan.
- Commits: 4b77504 (M6/M8/M9/M40/L20), 6268685 (M8-route/M11/M13/M14/M15/M16/M17), c59ff19 (L19).
