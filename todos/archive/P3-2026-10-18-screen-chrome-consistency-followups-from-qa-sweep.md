---
title: "Screen-chrome consistency follow-ups from the visual QA sweep"
status: done
priority: low
created: 2026-10-18
updated: 2026-10-18
assignee:
labels: [deferred, ui, qa-sweep]
github_issue:
---

# Screen-chrome consistency follow-ups from the visual QA sweep

## Summary

The visual QA sweep findings that are design-system decisions rather than one-line fixes. The owner asked (2026-10-18) for them to be filed, not declined, when the copy-and-consistency polish PR closed the rest of `todos/P2-2026-10-12-accessibility-layout-and-copy-polish.md`.

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local), groups F, H, I. Each item below changes a pattern shared by several screens, so each needs a decision on which pattern wins before any code moves.

- **#3** Home "Recipes" list mixes flat drawer rows (no subtitle) with subtitled cards — confirm which is intended.
- **#29** "Create" is a header "+" on Cookbooks but a floating button on Grocery Lists.
- **#66** The back button is a glass pill on some screens (Pantry, Favourites) and plain "‹ Back" text on others, even inside one stack (Profile: Favourites pill, Settings plain).
- **#80** Scan History (`client/screens/HistoryScreen.tsx`): three navigation cues (Back, "← Today", "All History"); the first tap on a row expands actions and only the second opens the item; the five action tiles are each a different colour. The contrast part of #80 (white on orange) was already fixed by the design-system todo; the tile now uses `theme.backgroundSecondary`.
- **#33** Recipe detail: "Ask Coach" is a Card (text inset ~46pt) directly under the flat "Community" section (inset 20pt). The Tips card above Community has the same inset as Ask Coach, so this is a section-style decision (card vs flat), not an Ask Coach bug. `client/components/AskCoachSection.tsx`, `client/components/RecipeCommunityStats.tsx`.
- **Favourites "Community" vs browser "Curated"**: `FavouriteRecipesScreen.tsx` labels every `recipeType === "community"` row "Community"; the browser and Home show a "Curated" badge for `isCanonical` rows. They are different facts (any shared recipe vs our hand-picked ones), and `ResolvedFavouriteRecipe` does not carry `isCanonical`, so showing the curated badge on Favourites needs the server row to include it (`server/storage/`, `shared/schema.ts`) and `CuratedBadge` on the card.
- **#25** The dairy category image `assets/images/ingredients/category-dairy.png` is an AI-generated picture whose text reads "Boiry" with a cow and a pat of butter; the sweep read it as a "Baby" jar. Regenerate or replace the asset (and check the other `category-*.png` files for garbled text).

## Acceptance Criteria

- [x] Owner decides each pattern (card vs flat sections, header "+" vs FAB, back-button style, Home row style).
- [ ] #80 list cues reduced to one back affordance; a row opens on the first tap or the expand affordance is explicit.
- [ ] Favourites shows "Curated" for canonical recipes or the owner confirms "Community" is the intended label.
- [ ] `category-dairy.png` replaced with an image without text, or text that reads "Dairy".
- [ ] Re-checked light + dark.

## Implementation Notes

- Each bullet in Background names its files. Keep one PR per pattern so a decision on one does not block the others.
- Back-button style: find the screens that set a custom `headerLeft` vs the stack default before proposing a single style.

## Scope Contract

- **Mechanisms to use:** existing components (`CuratedBadge`, `Card`, `HeaderTitle`, the stack navigators' `screenOptions`).
- **Files in scope:** the files named in Background, the navigators in `client/navigation/`, and their `__tests__`.
- No new mechanisms beyond those listed.

## Dependencies

- Owner decisions listed in the acceptance criteria.

## Risks

- Grab-bag scope again: keep PR checklists keyed by finding ID.

## Updates

### 2026-10-18

- Filed from the copy-and-consistency polish pass (owner: "file a todo for the out of scope items").

### 2026-10-19

Owner decisions (via the orchestrator):

- **#29** header "+" wins: Grocery Lists drops its FAB and gets a header "+" like Cookbooks.
- **#66** the native iOS glass pill wins everywhere; fix the root cause in shared options, no per-screen `headerLeft`.
- **#33** all boxed cards: the "Community" section goes into a `Card`.
- **Favourites** shows "Curated" (`CuratedBadge`) for canonical recipes; no schema change (`isCanonical` is an existing column).
- **#3** every Home Recipes row gets a subtitle.
- **#25** reuse an existing text-free ingredient image; no new AI image.
- **#80** one back affordance; a row opens on the first tap or the expand control is explicit (executor's choice).
- One PR, checklist keyed by finding ID.
