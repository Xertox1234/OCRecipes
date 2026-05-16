---
title: "Add render-test coverage for CoachChat (daily-limit banner / upgrade CTA)"
status: backlog
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, testing]
github_issue:
---

# Add render-test coverage for CoachChat (daily-limit banner / upgrade CTA)

## Summary

`client/components/coach/CoachChat.tsx` has no render test. The 2026-05-16
unfinished-features audit (finding H1) added interactive behavior — the
daily-limit banner's "Upgrade to Coach Pro" CTA opens `UpgradeModal` — that
shipped without an automated test because no `CoachChat` render harness
exists.

## Background

Surfaced during PR #193 review. `CoachChat` is a heavily-hooked component
(`useCoachStream`, `useChatMessages`, `useSpeechToText`, `usePremiumFeature`,
navigation, TanStack Query). Building a render harness for it was judged
disproportionate to the one-line CTA wiring at audit time, so the H1 fix was
verified by grep + the existing pure-util tests + code review only.

## Acceptance Criteria

- [ ] A render-test harness for `CoachChat` exists (mocks for the hooks above)
- [ ] Test: when `isAtDailyLimit` is true, the banner renders and the
      "Upgrade to Coach Pro" CTA is a pressable button
- [ ] Test: pressing the CTA opens `UpgradeModal` (`visible` becomes true)
- [ ] Test: a successful upgrade (`onUpgrade`) clears `isAtDailyLimit` so the
      banner is removed

## Implementation Notes

- The coach domain currently only has `coach-chat-utils.test.ts` (pure
  functions) — there is no precedent harness for the full component.
- Consider whether a lighter-weight extraction (a pure `limitBanner` helper)
  is a better testing seam than mounting the whole component.

## Dependencies

- A reusable mock set for the coach hooks, or an agreed testing seam.

## Risks

- Mounting `CoachChat` pulls in many hooks; an over-mocked test can pass
  while testing nothing real. Prefer testing a thin extracted unit.

## Updates

### 2026-05-16

- Initial creation (PR #193 review of audit 2026-05-16-unfinished-features, finding H1).
