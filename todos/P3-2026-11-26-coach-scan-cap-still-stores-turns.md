---
title: "Coach barcode and label turns are stored after the day's scan count is spent"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, server]
github_issue:
---

# Coach barcode and label turns are stored after the day's scan count is spent

## Summary

`POST /api/chat/conversations/:id/barcode` and `/label` store the user's turn
before they claim the day's `coachBarcodeScan` / `coachLabelRead` count, so a
spent count still writes two chat rows per request (the turn and the "scan
limit" reply).

## Background

Found by the security review of Coach roadmap V5 (the `/label` route). The
`/barcode` route has the same order. Coach Pro's daily message limit is
effectively unlimited (999999), so the only bound on stored rows is the
in-memory rate limit (10 or 15 a minute, reset on deploy): about 20,000+
rows a day for one account looping the route. The counts do bound the cards
and the product lookups / allergy-profile reads. Deferred because it changes
the shared handler's order for both routes.

## Acceptance Criteria

- [ ] When the day's count is spent, the request stores no chat row (for
      example: claim the count before the turn and answer 429 with
      `DAILY_LIMIT_REACHED`, or decide the current reply-in-chat is wanted
      and bound rows another way).
- [ ] A turn refused by the message limit still spends no count.
- [ ] Route tests cover both orders.

## Implementation Notes

- `server/routes/chat-barcode.ts` → `answerPhoneRead` (shared by both routes).
- Client copy for the refusal: `client/components/coach/coach-photo-utils.ts`
  (`coachPhotoFailure`).
- Tests: `server/routes/__tests__/chat-barcode.test.ts`.
