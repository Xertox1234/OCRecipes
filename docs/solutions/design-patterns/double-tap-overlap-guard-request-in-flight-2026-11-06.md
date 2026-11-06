---
title: "A double tap writes twice unless the route refuses an overlapping duplicate — rejectOverlapping answers REQUEST_IN_FLIGHT and the client stays quiet; claim-before-call caps sit after every cheap refusal"
track: knowledge
category: design-patterns
tags: [double-tap, idempotency, middleware, in-flight, 409, quota, ai-cost]
module: server
created: 2026-11-06
---

# Refuse an overlapping duplicate write; claim a cost cap only right before the paid call

## When this applies

A write route that the client can send twice before the first answers — log a meal, save a batch, confirm a receipt, import a URL, create a list. It also applies to any AI route behind a daily or monthly cap.

## Rule

- Mount `rejectOverlapping(keyOf)` (`server/lib/in-flight.ts`) after `requireAuth` and the rate limiter. The key **names the write**: the user plus the session, the URL, the destination or the payload. Two different writes never block each other (logging water then coffee quickly both go through).
- It answers `409` with `ErrorCode.REQUEST_IN_FLIGHT`, never `CONFLICT`. A route's own conflict (the cook log's incomplete-nutrition 409) must stay distinguishable.
- The client returns quietly on `isDuplicateInFlight(err)` (`client/lib/api-error.ts`) and leaves button state to the first request. The global error net is already quiet on 4xx.
- It refuses OVERLAPS only and is not an idempotency record. The offline queue's replays still need `X-Idempotency-Key` (`/api/scanned-items`).
- A claim-before-call AI cap (`claimAiCallOrReject`) sits **directly before the paid call**, after the size check, session caps and other cheap refusals. Placed earlier, a request refused for free still spends a claim, and a retry loop drains the day.

## Why

Session-based routes cleared their session only after the awaited write, so two overlapping requests both passed the check (`/api/photos/confirm`, cook-session `/log`). Others had no dedupe at all (beverages, batch save, receipt confirm, URL import with its image generation). An in-memory claim keyed per write, released on `res` `close`, closes that without touching handler bodies. It runs on a single server instance, like the in-memory sessions those routes already use.

## Examples

- Mounts: `server/routes/{photos,cooking,beverages,batch-scan,receipt,grocery,recipe-import}.ts`
- Tests: `server/lib/__tests__/in-flight.test.ts`; route double-tap tests hold the storage mock open with `mockImplementationOnce` (a persistent `mockImplementation` leaks into later tests and hangs them).
- Claim placement: `server/routes/photos.ts` (before `classifyAndAnalyze` / `analyzePhoto` / `analyzeLabelPhoto`), `server/routes/receipt.ts`.

## Related Files

- `server/lib/in-flight.ts`, `client/lib/api-error.ts`, `shared/constants/error-codes.ts`
- `shared/types/premium.ts` (`AI_DAILY_CAPS.photoAnalysis`, `receiptScan` — owner ruling 2026-11-05)

## See Also

- `docs/solutions/logic-errors/offline-replay-stamps-write-with-sync-time-not-occurred-time-2026-10-30.md`
