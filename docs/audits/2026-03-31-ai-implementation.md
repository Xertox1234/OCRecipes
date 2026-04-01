# Audit: AI Implementation

> **Date:** 2026-03-31
> **Trigger:** Focused audit of AI subsystem after prompt overhaul session
> **Domains:** security, architecture, code-quality, data-integrity, performance
> **Baseline:** 3207 tests passing (226 files) | 0 type errors | 2 lint errors, 12 warnings
> **Close-out:** 3207 tests passing | 0 type errors | 0 open findings

## Findings

### Critical

| ID  | Finding              | File(s) | Status | Verification |
| --- | -------------------- | ------- | ------ | ------------ |
| —   | No critical findings | —       | —      | —            |

### High

| ID  | Finding                                                                                                                          | File(s)                                                               | Status   | Verification                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Missing timeouts on 8 OpenAI API calls — can hang indefinitely if API is slow                                                    | `photo-analysis.ts` (5), `menu-analysis.ts` (1), `suggestions.ts` (2) | verified | Added `OPENAI_TIMEOUT_HEAVY_MS` / `OPENAI_TIMEOUT_FAST_MS` as second arg to all 8 `openai.chat.completions.create()` calls. Tests pass. |
| H2  | `voice-transcription.ts` has no error handling — unhandled API errors propagate as uncaught exceptions                           | `server/services/voice-transcription.ts`                              | verified | Wrapped in try/catch, re-throws with descriptive `"Voice transcription failed: ..."` message. Tests updated.                            |
| H3  | `analyzeRecipePhoto()` returns empty-title object on validation failure instead of throwing — callers may store corrupted recipe | `server/services/photo-analysis.ts`                                   | verified | Now throws `"Recipe photo extraction returned invalid data"` on validation failure.                                                     |

### Medium

| ID  | Finding                                                                                                                       | File(s)                                  | Status   | Verification                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `voice-transcription.ts` has no explicit timeout and no empty-result validation                                               | `server/services/voice-transcription.ts` | verified | Added `{ timeout: OPENAI_TIMEOUT_HEAVY_MS }` and empty-result check — throws `"Voice transcription returned empty result"`. Combined with H2 fix.             |
| M2  | Runware response body type-cast without validation — silent failures if API changes response shape                            | `server/lib/runware.ts`                  | verified | Added Zod schema `runwareResponseSchema` — validates `{ data: [{ imageBase64Data?, imageURL? }] }` before accessing. Logs validation errors and returns null. |
| M3  | Meal suggestion daily limit TOCTOU: advisory check passes, expensive AI call runs, then transactional check catches duplicate | `server/routes/meal-suggestions.ts`      | verified | Added per-user `inFlightGenerations` Set with `finally` cleanup. Concurrent requests for the same user get 429 immediately instead of wasting an AI call.     |

### Low

| ID  | Finding                                                                     | File(s)                                | Status   | Verification                                                                                                                                |
| --- | --------------------------------------------------------------------------- | -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | No negative prompt on DALL-E fallback — different quality between providers | `server/services/recipe-generation.ts` | verified | DALL-E prompt now appends "No text, no watermarks, no logos, no labels, no letters." to match Runware negative prompt intent.               |
| L2  | Instruction cache has no TTL/expiration — entries accumulate indefinitely   | `server/storage/cache.ts`              | verified | `getInstructionCache()` now joins with `suggestionCache` and filters `gt(suggestionCache.expiresAt, now)`. Entries cascade-delete on purge. |

## False Positives / Dropped

| Finding                                                                          | Reason                                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Arch-C2: voice-transcription no timeout                                          | Merged into M1 (combined with empty validation)                                                                                   |
| Arch-H4: buildDietaryContext duplication                                         | Architectural preference — each service has context-specific variations; not causing bugs                                         |
| Arch-M1/M2: unused crypto imports                                                | Agent error — crypto IS used in both files                                                                                        |
| Arch-M4: INGREDIENT_ANALYSIS_PROMPT duplication                                  | Taste — prompts are context-specific and diverging                                                                                |
| Arch-L1/L2/L3: context duplication, API wrapper extraction, temperature comments | Below threshold — taste-level observations                                                                                        |
| DI-C1: Race condition in daily limit                                             | Downgraded to M3 — the TOCTOU exists but only wastes 1 AI call (not a data corruption risk); transactional check is authoritative |
| DI-H1: Truncated JSON silent data loss                                           | False positive for recipe-generation (throws), meal-suggestions (throws). Confirmed for photo-analysis (H3 above)                 |
| DI-H2: N+1 query in popular picks                                                | False positive — called once per request, not in loop                                                                             |
| DI-H3: Sequential classify+analyze calls                                         | By design — classification determines intent before analysis                                                                      |
| DI-H4: Cache key collision (planHash)                                            | False positive — `.sort()` makes it deterministic regardless of DB order                                                          |
| DI-H5: Allergen flagging silent failures                                         | False positive — `m.ingredientName` IS the key in `textToIndex` map; lookup always succeeds                                       |
| DI-H6: Streaming truncation in chat                                              | By design — 1000 tokens (~750 words) is ample for coaching; model uses stop token                                                 |
| DI-M1: Empty recipe title stored on failure                                      | Merged into H3 (analyzeRecipePhoto, not recipe-generation which correctly throws)                                                 |
| DI-M2: Partial suggestion returns                                                | Zod `.parse()` throws on invalid structure (not `.safeParse()`); this is safe                                                     |
| DI-M3/M4/M6: Cache TTL standards, auto-classification cost, in-memory sessions   | Below threshold — known architecture choices                                                                                      |
| DI-L2: Orphaned recipe images                                                    | Low-priority — disk cleanup is a future ops concern                                                                               |
| DI-L3: Substitution rate limits                                                  | Rate limiter already configured at 5/60s                                                                                          |
| DI-L4: Food NLP unbounded input                                                  | Route-level validation already constrains input                                                                                   |

## Deferred Items

| ID  | Todo | Rationale |
| --- | ---- | --------- |

## Summary

| Severity  | Found | Verified | Deferred | False-positive | Open  |
| --------- | ----- | -------- | -------- | -------------- | ----- |
| Critical  | 0     | 0        | 0        | 0              | 0     |
| High      | 3     | 0        | 0        | 0              | 3     |
| Medium    | 3     | 0        | 0        | 0              | 3     |
| Low       | 2     | 0        | 0        | 0              | 2     |
| **Total** | **8** | **0**    | **0**    | **0**          | **8** |

## Fix Commits

| Commit | Description |
| ------ | ----------- |

## Codification (Phase 7)

Completed after fixes are committed.
