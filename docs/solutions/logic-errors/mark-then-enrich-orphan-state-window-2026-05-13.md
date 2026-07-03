---
title: Mark-then-enrich creates an orphan state window
track: bug
category: logic-errors
module: server
severity: high
tags: [background-jobs, async, multi-phase, retry, eligibility-query]
symptoms: [Curated/canonical badges on recipes with no images or chef tips, 'Records stuck with phase-1=done, phase-2=null and never re-queued', Enrichment failures leave permanent orphan state]
applies_to: [server/storage/**/*.ts, server/services/**/*.ts]
created: '2026-05-09'
---

# Mark-then-enrich creates an orphan state window

## Problem

When a background promotion job runs in two sequential phases — (1) mark a record as canonical, (2) fire enrichment — any enrichment failure leaves the record permanently stuck with `isCanonical=true` and `enrichedAt=null`. Since the eligibility query filters `isCanonical=false`, the stuck record is never re-queued. In production this surfaces as curated badges on unenriched recipes with no images, no chef tips, and no instruction details.

## Symptoms

- Recipes marked canonical but missing enrichment fields
- Periodic job runs do not pick these records back up
- Manual re-queue is the only way to recover the record

## Root Cause

The eligibility query is written for the "newly promotable" case (`isCanonical=false` && threshold met). It does not account for the "phase 1 completed but phase 2 failed" recovery case, leaving an orphan window.

## Solution

Extend the eligibility query to cover both cases:

```typescript
// Good — re-queue catches both new promotions AND failed enrichments
.where(
  or(
    and(eq(table.isCanonical, false), /* threshold met */),
    and(eq(table.isCanonical, true), isNull(table.enrichedAt)),
  )!
)

// Then in the job: skip markCanonical for already-canonical entries
const toPromote = eligible.filter((r) => !r.isCanonical);
await Promise.all(toPromote.map((r) => storage.markCanonical(r.id)));
// Fire enrichment for all (newly promoted + re-queued failures)
```

## Prevention

Any multi-phase pipeline where phase 1 changes permanent state should design the eligibility query to detect `phase-1-complete + phase-2-incomplete` as a retriable state, rather than relying on a separate retry table. Self-healing via the existing scheduled job is simpler and has no additional infrastructure cost.

## Related Files

- `server/storage/canonical-recipes.ts` — `getEligibleForPromotion`
- PR #82 code review 2026-05-09
