---
title: "Coach: Server-driven push notifications for commitment reminders"
status: done
priority: medium
created: 2026-04-29
updated: 2026-04-29
assignee:
labels: [coach, notifications, infrastructure]
---

# Coach: Server-driven push notifications for commitment reminders

## Summary

Upgrade commitment reminders from local scheduled notifications to server-driven push (APNs/FCM), so reminders survive app reinstallation and work across multiple devices.

## Background

The initial implementation (2026-04-29 coach improvement pass) uses `expo-notifications` local scheduled notifications — simpler, no backend infrastructure required. Server-driven push is the right long-term approach once the user base grows: it handles edge cases like reinstall, device swap, and multi-device ownership that local notifications cannot.

## Acceptance Criteria

- [x] Push token registration on login, persisted to `users` or a new `push_tokens` table
- [x] Backend sends APNs/FCM notification at commitment `followUpDate` (cron or scheduled job)
- [x] Tapping notification deep-links to the relevant notebook entry / CoachPro screen
- [x] Handles token rotation (new token replaces old)
- [x] Works on both iOS (APNs) and Android (FCM)
- [x] Graceful fallback if push delivery fails (in-app indicator still shown)

## Implementation Notes

- Use `expo-notifications` for token registration; tokens differ by platform (Expo push token vs raw APNs/FCM)
- Server needs: push token storage, a scheduler (pg-boss, BullMQ, or simple cron), APNs/FCM credentials
- Consider Expo Push Notification service as a unified delivery layer to avoid managing APNs + FCM separately
- When this is implemented, remove the local `expo-notifications` scheduling added in the initial pass and migrate existing scheduled notifications

## Dependencies

- Expo push token infrastructure
- APNs key + team ID (iOS) and Firebase credentials (Android)
- Server-side job scheduler

## Risks

- APNs/FCM credential management adds ops overhead
- Requires app store re-submission if entitlements change
- Token churn if users reinstall frequently

## Updates

### 2026-04-29

- Deferred in favour of local push notifications during initial coach improvement pass (no users yet, simpler to ship)
