---
title: "SecondFactorField 'announces the send once' test fails on every first attempt, passes only on retry"
status: done
priority: low
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, testing, client]
github_issue:
---

# SecondFactorField 'announces the send once' test fails on every first attempt

## Summary

`client/components/__tests__/SecondFactorField.test.tsx` > "announces the send once, and not again on each countdown tick" fails deterministically with `--retry=0` (`announceForAccessibility` called 2 times, expected 1), alone or in the full suite, on `main` at 7b190786. CI stays green only because `vitest.config.mts` sets `retry: 2`.

## Background

Found while verifying the supertest loopback-bind fix (2026-10-20). The component announces only inside `sendCode` (`client/components/SecondFactorField.tsx`, after `await emailCode.send()`), so it cannot announce on a countdown tick — the extra call must come from the test: most likely an earlier test's pending send/render resolving into the freshly-created `announceSpy`, or the spy being created before the previous test's tree is torn down. A retry passes because the leak is gone by then.

## Acceptance Criteria

- [ ] Root cause of the second `announceForAccessibility` call identified (log the call stack / message of each call)
- [ ] Test passes with `npx vitest run client/components/__tests__/SecondFactorField.test.tsx --retry=0` 10 times in a row
- [ ] The test still fails if `sendCode` is changed to announce twice (mutation check)

## Implementation Notes

- Files: `client/components/__tests__/SecondFactorField.test.tsx` (likely the only change), `client/components/SecondFactorField.tsx` (read-only unless the cause is in the component).
- Repro: `NODE_ENV=test npx vitest run client/components/__tests__/SecondFactorField.test.tsx --retry=0`.

## Updates

### 2026-10-20

- Cause: InlineError announces through `announceTogether` on a 0 ms real timer. The 429 test ended before it fired, so "Too many codes today…" landed in the next test's fresh spy (logged call stack: `announce-together.ts:21` <- timer). The component never announces on a tick.
- The "a refused send announces nothing" test was false, not just flaky: a refused send does announce the error; the assertion ran before the timer. Renamed to "announces the error, never 'Code sent'" and it now waits for the announcement.
- The 429 test now waits for its own announcement, so nothing leaks. 10/10 `--retry=0` runs pass; adding a second announce in `sendCode` fails the test (mutation check).
