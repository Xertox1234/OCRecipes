---
title: "Parallelize chat route DB queries and eliminate redundant getSubscriptionStatus"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, performance, chat]
---

# Parallelize chat route DB queries and eliminate redundant getSubscriptionStatus

## Summary

`POST /api/chat/conversations/:id/messages` makes 7+ DB queries with redundant user fetches and unnecessary sequential execution. Can be reduced to 1 parallel batch.

## Background

Found by: performance-oracle (CRITICAL-3)

The handler calls `getUser` and `getSubscriptionStatus` separately — both hit the users table. The user row already contains `subscriptionTier`. Additionally, queries 2-4 are sequential but independent and could join the existing `Promise.all`.

**File:** `server/routes/chat.ts`, lines 72-153

## Acceptance Criteria

- [ ] `getSubscriptionStatus` call eliminated — derive tier from `getUser` result
- [ ] All independent queries combined into a single `Promise.all`
- [ ] Reduces from ~7 sequential queries to ~1 parallel batch
- [ ] Expected savings: 6-18ms per chat message

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
