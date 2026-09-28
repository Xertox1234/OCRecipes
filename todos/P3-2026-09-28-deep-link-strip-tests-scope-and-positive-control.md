---
title: "Deep-link strip tests: the scope test doesn't assert scope, and ChatScreen's non-string test has no positive control"
status: backlog
priority: low
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, testing]
github_issue:
---

# Deep-link strip tests: scope assertion and positive control

## Summary

These are two gaps in the tests #1148 added. Both were found in #1148's review and are non-blocking; under the one-review-pass rule they get a follow-up. The production code was verified separately: the security-auditor ran a 27,600-URL corpus and found 0 leaks.

## Background

1. **Scope test.** `client/navigation/__tests__/linking.test.ts` has "keeps unrelated query params on other screens (strip is scoped to the chat routes)". It only asserts `toMatchObject({ mode: "label" })` on `scan?mode=label&initialMessage=x`. The reviewer built a mutant `stripLinkOnlyParams` that strips `initialMessage` from **every** route, and the test still passed. The real code keeps it: `{"initialMessage":"x","mode":"label"}`.
2. **Positive control.** `client/screens/__tests__/ChatScreen.test.tsx` has "never auto-sends a non-string initialMessage" (`conversationId: 42, initialMessage: ["a","b"]`). It only asserts `not.toHaveBeenCalled()`. No test in that file passes a string `initialMessage` with a valid id and asserts a send. So the suite can't tell "the guard filtered the array" apart from "auto-send never fires for id 42". `RecipeChatScreen.test.tsx` does have its positive sibling.

## Acceptance Criteria

- [ ] The scope test asserts the Scan route keeps `initialMessage`, e.g. `toEqual({ mode: "label", initialMessage: "x" })`. It must fail against a strip-everywhere mutant.
- [ ] `ChatScreen.test.tsx` gains a positive control. A valid `conversationId` plus a string `initialMessage` must lead to `sendMessage` being called with it. Check the exact call signature used elsewhere in the file first.

## Scope Contract

- **Files in scope:** `client/navigation/__tests__/linking.test.ts`, `client/screens/__tests__/ChatScreen.test.tsx`
- Test-only; no production change.

## Dependencies

- None

## Updates

### 2026-09-28

- Auto-filed (Low) from #1148's code review.
