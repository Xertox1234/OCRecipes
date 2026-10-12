---
title: "Design system: Coach Pro off ThemedText, green/off-palette colours, notebook layout"
status: in-progress
priority: medium
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [qa-sweep, ui, design-system]
github_issue:
---

# Design system: Coach Pro off ThemedText, green/off-palette colours

## Summary

Bring the Coach Pro area onto ThemedText/Poppins and fix the colour drift the 2026-10 visual QA sweep found (green "success" used as brand primary, off-palette accents, contrast failures).

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local), group G + SYS-C; screenshots `~/qa-sweep-2026-10/coach/`, `profile/`, `plan/`.

**SYS-C — system font.** Raw RN `<Text>` instead of `ThemedText`: `client/screens/CoachProScreen.tsx` 7, `client/components/coach/CoachDashboard.tsx` 14, `client/screens/AllConversationsScreen.tsx` 7, `client/screens/NotebookScreen.tsx` 7, `client/screens/NotebookEntryScreen.tsx` 14 = 49 raw / 0 ThemedText. App-wide 35 of 230 client `.tsx` use raw `<Text>` (`grep -rlE '<Text\b' client/screens client/components`); camera overlays may stay.

**Coach Pro findings.**

- #75 Medium: context card shows internal third-person notebook text verbatim ("User's breakfast consists of…"), contradicting the 0-calorie tile — `CoachDashboard.tsx:123-136`. Notebook entries also read "User has… / User committed…" — fix at display or at extraction (`server/services/` notebook extraction prompt), owner's call.
- #76 Medium: Notebook filter chips stretch into ~300pt-tall pills — horizontal ScrollView has no `style` (`flexGrow: 0`) — `NotebookScreen.tsx:217-221`, `:300-309`; archive/delete icons stacked under 44pt.
- #77 Medium: NotebookEntry off-system — hand-rolled header, white-on-amber chip ≈2.1:1, green "Mark Complete", grey "Save" reads disabled, free-text "YYYY-MM-DD" date (use a picker).
- #78 Low: CoachPro has no "Coach" title; mic button taller than the input; AllConversations bookmark + delete adjacent small targets.
- #87 Low: three different chat input designs (ChatScreen, CoachPro, CoachChat bare line); disclaimer only on CoachChat.
- #56 Low: ChatList Recipes segment empty state reuses the Coach copy; hand-rolled, not shared `EmptyState` (`client/screens/ChatListScreen.tsx:382-421`). #36: FavouriteRecipes empty state likewise.

**Colour drift.**

- #53 Medium: paywall primary green, white on `#4CAF7D` ≈2.5:1 in dark — `client/components/UpgradeModal.tsx`.
- #71 / #81: GoalSetup and EditDietaryProfile use `theme.success` for selection and primary buttons (`client/screens/GoalSetupScreen.tsx:494-496`, `client/screens/EditDietaryProfileScreen.tsx:290-403`); Settings "Units" selection green; #42 Welcome green accents.
- #11 Medium: RecipeEntryHub tiles — white on amber/green < 3:1; light-terracotta `link` used as fill in dark — `client/screens/meal-plan/RecipeEntryHubScreen.tsx`.
- #38 Medium: Plan calorie ring purple `#B794F6→#7C4DFF` behind a `// hardcoded` escape — `client/components/CalorieRing.tsx:75-76`.
- #80 Medium: ScanHistory "Today" dashboard — white on bright orange ≈3:1, radius ≈24 — `client/screens/HistoryScreen.tsx`; its 5 action tiles each a different colour.
- S1: `// hardcoded` = 114 lines / 49 files; ~17 off-palette (`#f59e0b`×4, `#22c55e`×2, `#4CAF7D`×2, `#2E7D32`/`#008A38`, `#C62828`×2); tab badge `#EF4444` at `client/navigation/MainTabNavigator.tsx:336` instead of `theme.error`; `ReceiptReviewScreen.tsx:59-66` colour dictionary.
- Lows: #4 SpeedDial labels vanish in dark; #16 disabled-button styles differ; #18 + sign-out sheet backdrop barely dims in dark; #9 "Curated" badge invisible on light photos; #85 no-camera fallbacks (three designs, white overlays on parchment); #50 goal icons pink/purple/blue; NutritionDetail "Help verify" card info-blue.

## Acceptance Criteria

- [ ] Coach Pro screens use ThemedText and type tokens; no raw `<Text>` left in the five files.
- [ ] #75, #76, #77 fixed; #78, #87, #56, #36 fixed or declined in the PR.
- [ ] Primary buttons and selections use brand tokens (`accentSolid` etc.), not `success`; all text ≥ 4.5:1 and icons ≥ 3:1 in both modes on the listed screens.
- [ ] Every remaining `// hardcoded` colour is either legitimate (comment says why) or replaced with a theme token.
- [ ] Re-checked light + dark on each listed screen.

## Implementation Notes

- Land after the screen-chrome todo's card-surface change (SYS-B) so contrast is judged on the final surfaces.
- `scripts/check-hardcoded-colors.js` only sees staged files; run it over the touched files.

## Scope Contract

- **Mechanisms to use:** `ThemedText`, `client/constants/theme.ts` tokens, shared `EmptyState`.
- **Files in scope:** the files named above and their `__tests__`; `client/constants/theme.ts` only if a token is genuinely missing.
- No new design tokens without saying why in the PR.

## Dependencies

- P1-2026-10-12-screen-chrome-tab-bar-header-card-surface (card surface).

## Risks

- Wide visual change; keep each screen's change reviewable.

## Updates

### 2026-10-12

- Filed from the visual QA sweep triage.
