---
title: "Recipe finder client: fix before the flag flip (double list announce; Regenerate under a finder list)"
status: done
priority: medium
created: 2026-09-28
updated: 2026-09-29
assignee:
labels: [deferred, client, recipe-finder, accessibility]
github_issue:
---

# Recipe finder client: fix before the flag flip

## Summary

Two flag-on-only client issues from PR C (#1160). Both must be settled before PR D flips
`RECIPE_FINDER_ENABLED`; neither is reachable while the flag is off.

## Background

PR C (#1160, merged `cd941443`) had one review pass. Under the one-review-pass rule its
non-blocking finding comes here instead of onto the reviewed branch. Item 2 was noticed while
merging; its server-side consequence is **not yet measured**.

1. **Double "Found N" announce in RecipeChef** (mobile-reviewer, #1160 @ `3226901c`).
   `RecipeResultsList` guards its arrival announce with a per-instance `announcedFlowRef`.
   `RecipeChatScreen` first renders the just-streamed reply as the pending bubble (id `-5`,
   `keyExtractor` → `"pending-assistant"`), which is the newest assistant message and not
   streaming, so the list is active and announces on mount. When the refetch lands, the persisted
   row has a different key, so the list remounts with a fresh ref and announces again. The pending
   bridge also announces "Recipe response received" in the same commit as the first mount, and two
   imperative announces in one commit can drop one on iOS. Coach is not affected: it filters finder
   blocks out of the streaming footer and mounts them only from the refetched message.
2. **Coach "↺ Regenerate" under a finder list** (read from the code, consequence unverified).
   `CoachChat`'s retry button renders under `lastAssistantMessageId`, which can now be a finder
   list. `handleRetry` (`client/components/coach/CoachChat.tsx`, `const handleRetry`) deletes that
   assistant message and the last user message, then re-sends the user message's text through
   `handleSend`, which carries no `finderAction`. After a button tap that user text is the button's
   label ("Generate", "None of these", or the chosen answers). What the server does with it — the
   typed-command guard, with the list it matched just deleted — has not been checked.

## Acceptance Criteria

- [x] RecipeChef announces a finder list's arrival exactly once per flow across the pending → persisted swap. Test: render pending then persisted and assert the list's `announceForAccessibility` call count is 1.
- [x] The list's announce doesn't collide with the bridge's "Recipe response received" on iOS: either one of them yields, or the bridge's message carries the count.
- [x] Item 2 measured first: what a Regenerate under a finder list sends and what the server does with it (route test through the typed-command guard). Then either hide Regenerate under a finder message, or make it re-run the finder action. Whichever is chosen, a test pins it.

## Implementation Notes

- Item 1 options, from the review:
  - Keep the pending finder message's identity across the swap, e.g. key the row by `flowId` for finder messages.
  - Or hoist the announced-flow guard above the remount, e.g. a module-level Set keyed by `flowId`.
  - Or skip the list's announce inside the pending bubble and let the bridge's announce carry it.
- Files:
  - `client/components/recipe-finder/RecipeResultsList.tsx` (announce effect)
  - `client/screens/RecipeChatScreen.tsx` (`keyExtractor`, pending bridge `announce`)
  - `client/components/coach/CoachChat.tsx` (`isRetryTarget`, `handleRetry`)
  - `server/routes/chat.ts` and `server/services/recipe-finder/entry.ts` (typed-command guard; item 2's measurement)
- Plan ledger: `.superpowers/sdd/2026-09-28-recipe-finder/progress.md`, "PR C" section.

## Resolution (2026-09-29)

1. The list inside RecipeChef's pending bubble no longer announces (`announceArrival={false}`).
   The persisted row announces once, in a later commit than the bridge's "Recipe response
   received". Measured before the fix: 1 "Found" announce at the pending stage, 2 in total; now 0
   then 1. Tests: `RecipeChatScreen.test.tsx` (pending → persisted swap) and
   `RecipeResultsList.test.tsx` (`announceArrival={false}` is silent).
2. Measured with the server's own `decideCoachFinderEntry` + `planFinderStep` on the history a
   Regenerate leaves (target assistant and user rows deleted, user text re-sent):
   - under a Spoonacular list (user text "Search Spoonacular"): typed, no command →
     `search_community` for "<request>. Search Spoonacular". Wrong source, garbled query.
   - under a round-1 list (user text = the joined answers): round-1 community search with the
     answers' labels but not their questions. Close, not identical.
   - under a questions block (user text "None of these"): `ask_clarifying`. Identical.
     Ruling: Coach hides Regenerate under any finder message (results or questions); its own
     buttons are the next step. RecipeChef has no Regenerate. Test: `CoachChat.branches.test.tsx`
     "shows no Regenerate under …".
