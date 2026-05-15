---
title: "Fix missing insets.bottom and FLATLIST_DEFAULTS in Notebook/AllConversations screens"
status: in-progress
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, camera, react-native, audit-2026-05-09]
---

# Fix missing insets.bottom and FLATLIST_DEFAULTS in Notebook/AllConversations screens

## Summary

Three issues in new screens: NotebookScreen list has no `insets.bottom` padding (last item clipped behind home indicator), AllConversationsScreen uses fixed `Spacing.xl` instead of `insets.bottom + Spacing.xl`, and NotebookScreen FlatList is missing `FLATLIST_DEFAULTS`.

## Background

Identified in the 2026-05-09 full audit (M4, M12) by the performance-specialist and camera-specialist agents.

## Acceptance Criteria

- [ ] `NotebookScreen.tsx:281` — add `paddingBottom: insets.bottom + Spacing.md` to list content container
- [ ] `AllConversationsScreen.tsx:272` — change `paddingBottom: Spacing.xl` to `paddingBottom: insets.bottom + Spacing.xl`
- [ ] `NotebookScreen.tsx:236` — spread `{...FLATLIST_DEFAULTS}` on the FlatList
- [ ] Visual test: last list item not clipped on iPhone with home indicator

## Implementation Notes

`FLATLIST_DEFAULTS` is from `@/constants/lists` (or `@/constants/performance` — check the import path used in adjacent screens).
