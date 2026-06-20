---
title: "Add a render test for VerifyEmailScreen's state machine"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, testing, react-native]
github_issue:
---

# Render test for VerifyEmailScreen

## Summary

`client/screens/VerifyEmailScreen.tsx` (171 lines) ships with only its pure utils
tested (`VerifyEmailScreen-utils.test.ts`). The screen's own state machine is
unverified.

## Background

From the PR #403 review (email verification). The plan deliberately scoped client
tests to the pure utils + LoginScreen navigation, leaving the verify screen's
branch logic uncovered. The login→VerifyEmail navigation IS render-tested
(`LoginScreen.test.tsx`), so the gap is specifically the screen's internal
transitions.

## Acceptance Criteria

- [ ] A jsdom render test (mirroring `LoginScreen.test.tsx` setup —
      `renderComponent`, mocked `@react-navigation/native`, mocked
      `VerifyEmailScreen-utils`) covers:
  - [ ] token param present → calls `verifyEmailRequest` on mount → `confirmed`
        state renders "Email verified ✓"; verify rejects → `failed` state.
  - [ ] `confirmed` "Back to sign in" button calls `navigation.navigate("Login")`.
  - [ ] `linkSent` copy switch: arriving with an `email` param shows "Check your
        inbox"; arriving with no params shows "Verify your email" / "isn't
        verified yet".
  - [ ] `onResend` with an invalid email shows the InlineError and does NOT call
        `resendVerificationRequest`; with a valid email calls it and flips copy.
- [ ] `AccessibilityInfo.announceForAccessibility` is asserted on the
      confirmed/failed/resend transitions (mock `AccessibilityInfo`).

## Implementation Notes

- `client/screens/__tests__/VerifyEmailScreen.test.tsx` (new). Mirror the mock
  style in `client/screens/__tests__/LoginScreen.test.tsx`: `vi.hoisted` spies,
  `vi.mock("@react-navigation/native", ...)`, `renderComponent` from
  `test/utils/render-component`.
- Mock `./VerifyEmailScreen-utils` so `verifyEmailRequest` / `resendVerificationRequest`
  are spies you control (resolve/reject), and assert the resulting UI/announce.
- Use a distinct basename from any `.test.ts` sibling (RN render-test harness +
  `.ts`/`.tsx` collision gotcha).

## Dependencies

- Builds on the email-verification feature (PR #403).

## Risks

- None — test-only addition.
