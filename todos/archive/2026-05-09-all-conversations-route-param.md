---
title: "Replace function route param in AllConversationsScreen with navigation event"
status: done
priority: high
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, camera, react-native, audit-2026-05-09]
---

# Replace function route param in AllConversationsScreen with navigation event

## Summary

`AllConversations` screen is typed with `{ onSelect: (id: number) => void }` and receives `setConversationId` as a route param. Functions are non-serializable — state persistence breaks, deep-linking to this screen crashes on restore.

## Background

Identified in the 2026-05-09 full audit (H6) by the camera-specialist agent. React Navigation v7 warns about non-serializable params in dev mode. On iOS background kill + restore, the callback will be undefined and the screen will throw.

## Acceptance Criteria

- [ ] Remove `onSelect` from the route params type in `RootStackNavigator.tsx:153`
- [ ] In `AllConversationsScreen`, after selection call `navigation.navigate("CoachPro", { selectedConversationId: id })`
- [ ] In `CoachProScreen`, read `route.params?.selectedConversationId` and apply it on mount/change via `useEffect`
- [ ] Deep-link `ocrecipes://conversation-list` navigates correctly
- [ ] State restoration after iOS background kill works

## Implementation Notes

`CoachProScreen` already has `conversationId` state — the `selectedConversationId` param becomes an initial value for that state. Clean up the param after reading it to avoid re-applying on back-navigation.
