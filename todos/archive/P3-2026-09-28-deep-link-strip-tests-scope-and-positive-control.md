---
title: "Deep-link strip tests: the scope test doesn't assert scope, and ChatScreen's non-string test has no positive control"
status: done
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

- [x] The scope test asserts the Scan route keeps `initialMessage`, e.g. `toEqual({ mode: "label", initialMessage: "x" })`. It must fail against a strip-everywhere mutant.
- [x] `ChatScreen.test.tsx` gains a positive control. A valid `conversationId` plus a string `initialMessage` must lead to `sendMessage` being called with it. Check the exact call signature used elsewhere in the file first.

## Scope Contract

- **Files in scope:** `client/navigation/__tests__/linking.test.ts`, `client/screens/__tests__/ChatScreen.test.tsx`
- Test-only; no production change.

## Dependencies

- None

## Updates

### 2026-09-28

- Auto-filed (Low) from #1148's code review.

### 2026-09-29

- Implemented both fixes. `linking.test.ts`'s scope test now pins the full params object with `toEqual({ mode: "label", initialMessage: "x" })` instead of `toMatchObject({ mode: "label" })`. Proved it catches the strip-everywhere mutant: applied a one-line local mutant to `stripLinkOnlyParams` in `client/navigation/linking.ts` (`LINK_STRIPPED_PARAMS[route.name] ?? ["initialMessage"]`, stripping `initialMessage` from every route instead of only `Chat`/`RecipeChat`), ran `client/navigation/__tests__/linking.test.ts` (1 failed | 44 passed — only the scope test went red), reverted the mutant, ran again (45 passed). `ChatScreen.test.tsx` gained "auto-sends a string initialMessage for an existing conversation" (`conversationId: 42`, string `initialMessage`), asserting `sendMessage` called with the single-argument signature (`handleSend`'s `else` branch for a non-null `conversationId`, not the 3-arg create-flow form). Reviewed clean by `code-reviewer` + `mobile-reviewer` (no findings, 0 review rounds).
