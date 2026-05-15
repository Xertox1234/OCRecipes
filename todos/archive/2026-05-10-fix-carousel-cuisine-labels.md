---
title: "Fix carousel 'Matches your cuisine preferences' labels not appearing after taste profile save"
status: backlog
priority: high
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [personalization, carousel, taste-picks]
github_issue:
---

# Fix carousel cuisine-match labels after taste profile save

## Summary

After a user saves their Taste Profile, the Home tab carousel still shows "Recently added recipe" labels instead of "Matches your cuisine preferences". The server is returning correct labels, but the client cache is stale.

## Background

The carousel query (`/api/carousel`) has a 30-minute stale time in TanStack Query. When a user updates their taste picks, the derived cuisine signals on the server are updated correctly, but the cached carousel response on the client is not invalidated.

Two previous attempts were made:

1. Added `queryClient.invalidateQueries({ queryKey: ["/api/carousel"] })` to `handleSave` in `TasteProfileScreen.tsx` — did not fix the issue. The invalidation call was added but the labels still did not update after saving.
2. Fixed `server/storage/taste-picks.ts` to derive cuisine signals from `dietTags` when `cuisineOrigin` is NULL — this was the correct fix for getting cuisines written to `user_profiles.cuisine_preferences`, but it was not sufficient for the labels to appear.

The client-side invalidation change is committed at `458ebc55` on `feat/personalization-2c-rebase`.

## Acceptance Criteria

- [ ] After saving Taste Profile (Settings → Taste Profile → Save Changes), the Home tab carousel shows "Matches your cuisine preferences" labels on relevant recipes **without** requiring a manual pull-to-refresh
- [ ] The fix works on iOS 26 simulator with the demo/demo123 account

## Implementation Notes

**Things to verify before writing new code:**

1. **Confirm the carousel query key** — check what key TanStack Query actually uses for the carousel. In `TasteProfileScreen.tsx` we invalidate `["/api/carousel"]`, but if the actual query key is different (e.g. includes extra params), invalidation silently does nothing.
   - Search for `useQuery` or `useInfiniteQuery` calls that hit `/api/carousel` in the client codebase.

2. **Confirm `userProfiles.cuisinePreferences` is actually being written** — connect to the DB and check the demo user's `cuisine_preferences` column after saving taste picks:

   ```sql
   SELECT cuisine_preferences FROM user_profiles WHERE user_id = '24446d17-651e-4f84-a20a-4f887c4c9d09';
   ```

   If empty, the storage write-through is still broken (the `dietTags` fix may not have taken effect for the current picks).

3. **Confirm the carousel builder reads `cuisinePreferences`** — check `server/services/carousel-builder.ts` `generateCommunityReason()`. It compares `recipe.dietTags` against `profile.cuisinePreferences`. If the profile isn't being loaded correctly, labels won't appear even with correct DB state.

4. **Confirm direct API call returns labels** — after updating taste picks, call the carousel API directly to verify server response:

   ```bash
   curl -s -H "Authorization: Bearer <token>" http://localhost:5000/api/carousel | jq '.sections[].recipes[].reason'
   ```

5. **The actual `queryClient.invalidateQueries` call** — double-check it runs by adding a temporary `console.log` before the call. The `handleSave` `useCallback` dependency array must include `queryClient`.

**Key files:**

- `client/screens/TasteProfileScreen.tsx` — `handleSave` (line ~100), invalidation call
- `server/storage/taste-picks.ts` — `setTastePicks()`, cuisine derivation
- `server/services/carousel-builder.ts` — `generateCommunityReason()`
- Wherever the carousel query is defined/called on the client (search for `/api/carousel`)

**Demo account:** user ID `24446d17-651e-4f84-a20a-4f887c4c9d09`, credentials `demo/demo123`

## Dependencies

- `feat/personalization-2c-rebase` branch must be the working branch (or these changes merged to main)

## Risks

- The carousel query key mismatch is the most likely culprit — invalidating the wrong key is a silent no-op
- The `setTastePicks` `cuisinePreferences` return value vs what gets written to `userProfiles` — the plan at some point described NOT mutating `userProfiles.cuisinePreferences`, but the actual implementation in `server/storage/taste-picks.ts` does update the profile. Verify the final state of that function.

## Updates

### 2026-05-10

- Initial creation. Two fix attempts were made in the prior session without resolving the issue. Root cause not confirmed.
