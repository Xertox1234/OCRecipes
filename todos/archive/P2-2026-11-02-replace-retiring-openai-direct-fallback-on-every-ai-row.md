---
title: "Replace the retiring direct-OpenAI fallback on every AI_FEATURES row before 2027-01-14"
status: done
priority: medium
created: 2026-11-02
updated: 2026-11-03
assignee:
labels: [deferred, ai]
github_issue:
---

# Replace the retiring direct-OpenAI fallback on every AI row

## Summary

Every non-Vertex row in `server/lib/ai-models.ts` falls back to a direct-OpenAI model (`gpt-4o` or `gpt-4o-mini`) when OpenRouter is down, its circuit breaker is open, or its balance is exhausted (402). OpenAI direct shuts both down on **2027-01-14**; from then on the fallback errors instead of answering. Owner goal (2026-10-19): replace OpenAI entirely, including as the backup.

## Background

Deferred from PR #1700 (recipe-chat → Gemini 3.8 Flash, 2026-11-02). The owner asked for a different fallback on that row; none of the obvious picks works today:

- **gpt-5-nano**: OpenAI's deprecations page lists its shutdown as 2026-12-11, _before_ gpt-4o. Also, like every GPT-5/6 reasoning model, it rejects `temperature` ≠ 1, and the fallback request is sent unadapted (`server/lib/ai-client.ts` ~line 255: `{ ...params, model: fallbackModel(...) }`). `adapt` only reaches the OpenRouter attempt.
- **gpt-6-luna**: same temperature problem.
- **A Gemini model (e.g. Argon)**: `fallback` is an OpenAI-direct model id; the slot cannot name a Google model.

The only OpenAI-free routing that exists is the `primary: "vertex"` path (Vertex direct → OpenRouter, no OpenAI; spec `docs/superpowers/specs/2026-10-19-vision-rows-vertex-direct*`), used by vision rows. It has not been used for a streaming row.

## Acceptance Criteria

- [x] Design decided 2026-11-02: spec `docs/superpowers/specs/2026-11-02-vertex-backup-route-design.md` (OpenRouter primary → Vertex direct, Gemini 3.8 Flash at low reasoning; never OpenAI).
- [x] PR 1 plumbing merged (#1703: `vertexBackup` field, routing incl. streaming, thought-signature fill, `ai:smoke --backup`).
- [x] PR 2: the five rows (coach-chat, coach-pro-chat, recipe-chat, recipe-generate, photo-analyze) switched and the privacy page updated, after the live gate.
- [x] The other 29 rows: decided 2026-11-03 (owner) — same Vertex backup, in two PRs: PR 3 the 21 text rows, PR 4 the 8 vision rows.
- [x] PR 3: the 21 text rows switched, live gate clean, privacy page updated.
- [x] PR 4: the 8 vision rows (recipe-chat-image, photo-recipe, photo-label, photo-classify, receipt-scan, menu-scan, front-label-scan, cooking-ingredient-photo).
- [x] No row's fallback names a model whose shutdown date is on or before the switch-over date, checked against OpenAI's deprecations page that day.
- [x] `server/lib/__tests__/ai-models.test.ts` pins the new rule.
- [x] Done before 2027-01-14.

## Implementation Notes

- Rows: `server/lib/ai-models.ts` (`FAST`, `HEAVY`, `LUNA`, and the explicit `recipe-generate`, `photo-analyze`, `recipe-chat` rows).
- Router: `server/lib/ai-client.ts` (`fallbackModel`, the OpenRouter → fallback branch, the Vertex branch).
- Background: memory note on gpt-4o retirement (dates on both paths; Azure via OpenRouter retires gpt-4o/mini 2027-04-14, which is a separate, later deadline for the primary routes still on `openai/gpt-4o*`).

## Dependencies

- Owner decision on the design (first criterion).

## Risks

- A design that adds a second Google route for streaming rows touches `aiChat`'s streaming path, which every coach and recipe-chat reply uses.

## Updates

### 2026-11-03 (PR 4 — closes this todo)

- The 8 vision rows (recipe-chat-image, photo-recipe, photo-label, photo-classify, receipt-scan, menu-scan, front-label-scan, cooking-ingredient-photo) now back up to Vertex direct (Flash, low reasoning); `FAST_VISION` / `HEAVY_VISION` are gone, so no row has an OpenAI-direct `fallback` at all (the "no row names a retiring model" criterion holds vacuously). `ai-models.test.ts` pins "every row backs up to Vertex, never OpenAI".
- `npm run ai:backup-gate` drives the 8 through their real service functions on a photo of each kind (`scripts/ai-backup-gate-vision-rows.ts`; every image looked at first — `e2e/assets/receipt.jpg` turned out to be a bowl of tomatoes, not a receipt). The first run rejected 3/3 receipts: Gemini writes `"unit": null` where GPT omits the key; every `.optional()` field in the receipt and menu schemas now reads null as "not given". Final run 23/24, then the one failing row alone 6/6; the miss was a Vertex 429 after the menu rows' large replies (capacity, as in PR 3). cooking-ingredient-photo has a long latency tail on Vertex (42–60 s in 4 of 12 samples; normally 4–8 s).
- Privacy page: OpenAI is no longer a direct backup for any feature; the Google row lists photo, label, receipt and menu scanning among the features it backs up.
- Left in place: the OpenAI-direct `fallback` code path in `ai-client.ts` (no production row uses it now; its tests build rows with it).

### 2026-11-03 (PR 3)

- The 21 text-only rows (`FAST` / `HEAVY`) now back up to Vertex direct (Flash, low reasoning), never OpenAI; the 8 vision rows moved to `FAST_VISION` / `HEAVY_VISION`, which keep the OpenAI fallback until PR 4. `ai-models.test.ts` pins "every text row: vertexBackup, no fallback".
- `npm run ai:backup-gate` drives all 21 through their real service functions (`scripts/ai-backup-gate-text-rows.ts`) and reports a service's stand-in value as a failure. The first run found three rows broken on the backup; owner rulings, all fixed: notebook extraction sent a conversation ending on the coach's turn, which Vertex rejects (400) — the transcript is now one user message; art direction rejected Gemini's longer phrases — now trimmed; three short deadlines timed Vertex out — `aiChat` takes a `backupTimeout` for the Vertex leg. Later runs found more, also fixed on owner rulings: Flash cannot turn thinking off (`none`/`minimal` → 400, `thinking_budget: 0` ignored) and once spent 189 of a 200-token cap on it, so the backup body adds `VERTEX_BACKUP_REASONING_HEADROOM` (1000); every 15 s "fast" caller gets 30 s on the backup leg; pantry-meal-plan's schema now accepts "Breakfast"/"easy"; a Vertex 429 is retried once after 1 s (never a timeout). The remaining failures were Vertex capacity (slow answers, 429s) that come and go.

### 2026-11-03 (PR 2)

- The five rows (coach-chat, coach-pro-chat, recipe-chat, recipe-generate, photo-analyze) now back up to Vertex direct (Flash, low reasoning), never OpenAI; privacy page updated. Live gate (`npm run ai:backup-gate`): 21/21 samples clean, 35 calls, no `length` finish, both coach-pro route-switch directions exercised. PR 1 (#1703) shipped the plumbing. Stays open for the other 29 rows, which still fall back to gpt-4o / gpt-4o-mini.

### 2026-11-02 (design)

- Owner ruled the backup route: Vertex direct, Flash for every row. Spec approved; PR 1 (plumbing, no row flagged) in review. Stays open for PR 2 and the other 29 rows.

### 2026-11-02

- Initial creation (owner, while reviewing PR #1700: "merge now, fix backup later").
