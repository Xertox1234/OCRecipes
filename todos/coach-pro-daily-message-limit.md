---
title: "Coach Pro: Enforce coachProDailyMessages rate limit"
status: backlog
priority: medium
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, server, rate-limiting]
---

# Coach Pro: Enforce coachProDailyMessages rate limit

## Summary

The `coachProDailyMessages` field exists in `PremiumFeatures` (set to 999999 for premium, 0 for free) but is never checked in the chat route. Coach Pro users are subject to the same `dailyCoachMessages` limit as basic coach users.

## Background

The chat route checks `features.dailyCoachMessages` for coach conversations. When Coach Pro has a separate tier with its own pricing, it should check `features.coachProDailyMessages` instead when `isCoachPro` is true.

## Acceptance Criteria

- [ ] Chat route checks `coachProDailyMessages` when user has `coachPro` feature
- [ ] Free users without `coachPro` continue to use `dailyCoachMessages` limit
- [ ] Rate limit error message distinguishes Coach Pro from basic coach

## Implementation Notes

- In `server/routes/chat.ts`, the `dailyLimit` variable is set around line 266-269
- Add an `isCoachPro` check to use `features.coachProDailyMessages` when applicable
- Consider whether Coach Pro should have a different tier structure (e.g., a "coach_pro" tier in `subscriptionTiers`)
