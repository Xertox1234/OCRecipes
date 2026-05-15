---
title: "Low-severity audit items (2026-05-09)"
status: done
priority: low
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, low, audit-2026-05-09]
---

# Low-severity audit items (2026-05-09)

## Summary

Batch of low-severity items from the 2026-05-09 full audit. None are individually worth a dedicated PR but collectively worth a clean-up pass.

## Items

### Data Integrity

- [ ] **L1** — `deleteUser` cascade: clean up `favouriteRecipes` rows for other users when deleting a user's community recipes (currently only `cookbookRecipes` are cleaned; lazy orphan cleanup via `getResolvedFavouriteRecipes` fire-and-forget handles it eventually, but inconsistent with `deleteCommunityRecipe`). File: `server/storage/users.ts:174–195`

### Architecture

- [ ] **L2** — `coach-commitments.ts` exports `registerCoachCommitmentsRoutes` instead of canonical `register`. File: `server/routes/coach-commitments.ts:9`
- [ ] **L3** — `chat.ts` (576 lines) and `community.ts` (521 lines) approaching decomposition threshold — track growth

### Performance

- [ ] **L6** — FastingDrawer: memoize `progress`, `subtitle`, `formatTimeToGoal` with `useMemo` (30s tick rate makes impact low). File: `client/components/home/FastingDrawer.tsx:86,120,263`
- [ ] **L7** — FastingDrawer: extract 6+ repeated `withOpacity(theme.textSecondary, 0.08)` calls to module-level or useMemo'd block. File: `client/components/home/FastingDrawer.tsx:141,180,196,267–307`
- [ ] **L8** — `search_recipes` tool in `coach-tools.ts:512` independently fetches `getUserProfile` — pre-fetched profile from `coach-pro-chat.ts` initial `Promise.all` should be threaded through to avoid redundant DB call

### Code Quality

- [ ] **M10** — `saveRecipeFromChat` uses `msg.metadata as Record<string, unknown>` before Zod validation — move `rawMetadata` assignment inside the parsed block or change to `unknown`. File: `server/storage/recipe-from-chat.ts:63`
- [ ] **M11** — Legacy `savedRecipeId` check (lines 63–79) runs before `!parsed.success` guard (line 82) — reorder so Zod parse runs first, then branch on `savedRecipeId`. File: `server/storage/recipe-from-chat.ts:63–82`
- [ ] **L10** — `beverages.ts:108` uses literal string `"NUTRITION_LOOKUP_FAILED"` instead of `ErrorCode.*` constant
- [ ] **L11** — `recipe-chat.test.ts:282` has unused `_` variable in drain loop — use `_chunk` or add eslint-disable comment

### Accessibility

- [ ] **M14** — QuickLogDrawer error nodes use `accessibilityLiveRegion="polite"` — must be `"assertive"` so screen readers interrupt current utterance for errors; use `InlineError` component. File: `client/components/home/QuickLogDrawer.tsx:324–329, 391–396`
- [ ] **L12** — `NotebookEntryScreen.tsx:197–202` Save Pressable uses `disabled` prop but not `accessibilityState={{ disabled: ... }}` (TalkBack ignores `disabled` prop)
- [ ] **L13** — `WeightLogDrawer.tsx:267–293` progress bar has no `accessibilityRole="progressbar"`, `accessibilityValue`, or label
- [ ] **L14** — `FastingDrawer.tsx:217,230,380` decorative emoji (🔥, 📊, 🌙) should be wrapped in `<Text accessible={false}>` to avoid VoiceOver announcing Unicode names

### Design System

- [ ] **M13** (from medium, grouped here for cleanup pass) — `TYPE_COLORS` hardcoded hex dictionary duplicated in `NotebookScreen.tsx:25–34` and `NotebookEntryScreen.tsx:40–49`; extract to shared constant and verify dark-mode contrast

## Implementation Notes

Items can be addressed individually during normal feature work or in a dedicated clean-up PR. L2, L10, L11 are trivial one-liners.
