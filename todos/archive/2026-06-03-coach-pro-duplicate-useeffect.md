---
title: "Remove duplicate useEffect in CoachProScreen with identical deps and body"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Remove duplicate useEffect in CoachProScreen with identical deps and body

## Summary

`CoachProScreen` has two `useEffect` hooks with identical deps (`route.params?.selectedConversationId`, `navigation`) that both call `setConversationId` + `navigation.setParams`. One is redundant; declaration-order stability is a fragile invariant.

## Background

Deferred from 2026-06-03 full audit (M13). File: `client/screens/CoachProScreen.tsx:77-82,104-110`.

## Acceptance Criteria

- [ ] One of the two duplicate effects is removed
- [ ] Remaining effect correctly handles the `selectedConversationId` param change
- [ ] No regression in conversation selection from route params

## Implementation Notes

Read both effects carefully — they may differ subtly (different conditions or early-returns). If truly identical, remove the later one. If slightly different, merge the two into one.

## Dependencies

- None

## Risks

- Navigation param clearing behavior; test the deep-link and in-app navigation paths

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M13)
