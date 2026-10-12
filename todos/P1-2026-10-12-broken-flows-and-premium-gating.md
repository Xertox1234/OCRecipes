---
title: "Broken flows and premium gating: Profile rate-limit error, unreachable scan options, recipe-chat gating"
status: backlog
priority: high
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [qa-sweep, ui, server]
github_issue:
---

# Broken flows and premium gating

## Summary

Fix the non-auth flows the 2026-10 visual QA sweep found broken or misleading: Profile collapsing into an error screen under normal use, two scan options that can't be reached, and premium features that fail late instead of showing a lock.

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local), groups C, E, F; screenshots `~/qa-sweep-2026-10/`.

- **#61 High — Profile rate limit.** Tapping the locked Pantry tile / closing the paywall fires a burst of `GET /api/profile/widgets` + `/api/profile/library-counts` (~30ms apart). `hubRateLimit` is 15/min shared across both (same in production — `resolveRateLimitMax` only relaxes under `E2E_RELAXED_RATE_LIMITS` in dev) → 429 → full-screen "Couldn't load your profile — check your connection". 429 confirmed in logs once (5× at 09:11:56); same screen seen twice. Files: `server/routes/profile-hub.ts:10-14`, `client/hooks/useProfileData.ts` (find the refetch burst; 4xx are not retried, so the burst is the screen's own).
- **#84 High — PhotoIntent options off-screen.** 7 options in a plain `View` inside `content { flex: 1 }`, no ScrollView: "Scan nutrition label" and "Cook & Track" are below the screen edge on iPhone 17 Pro; Cook & Track (CookSessionCapture) is unreachable from here. Also: pre-selected option outlined green, step indicator shows 2/3 before any photo, FAB label "Scan Menu" opens this generic picker. `client/screens/PhotoIntentScreen.tsx:39-86`, `:149-172`, `:272-275`.
- **#86 Medium — NutritionDetail not found.** Unknown barcode renders the full facts layout with dashes and keeps "Add to Today" as primary (logs an "Unknown Product"); no "scan the label" / "enter manually" path. Found-state Lows: card pure white in light, "1 tsp / 1 tbsp" servings for a can, "PER 1 × 1 PORTION", "Contains caffeine" vs "Caffeine — Not recorded". `client/screens/NutritionDetailScreen.tsx`.
- **#59 Medium — Recipe Chat gating.** Free user reaches RecipeChat via Coach → Recipes → New Chat with no lock (Home locks "Generate Recipe"); on send the prompt vanishes, a raw red bubble says "Recipe Generation requires a premium subscription", no Upgrade CTA, and an empty "New Recipe Chat" stays in the list. `client/screens/ChatListScreen.tsx`, `client/screens/RecipeChatScreen.tsx`, `server/routes/chat.ts:335`. Related #57: subtitle promises "upload a photo of ingredients" but there is no photo control; `POST /api/chat/conversations/:id/upload-image` (`server/routes/recipe-chat.ts:156`) has no client caller — either add the control or drop the copy.
- **#65 Low — Pantry lock treatments.** Home Pantry row has no `premium` flag (`client/components/home/action-config.ts:179`) and opens Pantry's own lock screen; Profile tile opens the paywall. Make them consistent.
- **#54 Medium — Paywall.** Auto-renew disclosure and Terms/Privacy below the fold on open (App Review expects them visible near the CTA); feature list omits Quick Log and Pantry, which open it. `client/components/UpgradeModal.tsx`.
- **#10 Medium — RecipeBrowser "+ Add" changes tabs.** The original "lands on Profile" was not reproduced (2 fresh runs). Reproducible: from the Profile-stack browser (Profile → Recipes tile), "+ Add" jumps to the Plan tab and Back can't return. `client/screens/meal-plan/RecipeBrowserScreen.tsx:780-791`.

## Acceptance Criteria

- [ ] Normal Profile use (tile taps, opening/closing the paywall, tab switches) never shows the error screen; burst source removed and/or limit sized for real use; a 429 shows a rate-limit message, not "check your connection".
- [ ] All 7 PhotoIntent options reachable on iPhone 17 Pro and SE size, with and without the photo thumbnail.
- [ ] Unknown-barcode NutritionDetail offers a real next step and does not offer to log an empty product.
- [ ] Free users see the recipe-chat lock before typing; a refused send keeps the prompt and offers Upgrade; no empty conversation left behind; #57 copy matches what the screen can do.
- [ ] Pantry shows one lock treatment from Home and Profile; paywall lists the features that open it and shows renewal terms without scrolling.
- [ ] "+ Add" from the Profile-stack browser stays in a sensible stack (decide: push within Profile, or jump with working Back).
- [ ] Tests for the rate-limit fix (server route test) and any extracted pure logic.

## Implementation Notes

- #61: check whether `useProfileData` remounts / invalidates on modal close; a shared query key with `staleTime` may already prevent the burst.
- #84: wrap options in a ScrollView (or FlatList); keep `accessibilityViewIsModal`.

## Scope Contract

- **Mechanisms to use:** existing rate limiter factory, TanStack Query options, `usePremiumFeature` / premium context, existing UpgradeModal.
- **Files in scope:** the files named above and their `__tests__`.
- No new mechanisms.

## Dependencies

- None.

## Risks

- Changing the hub rate limit affects production abuse protection — size it from the measured burst, don't remove it.
- Premium gating touches server routes; keep server checks as the source of truth.

## Updates

### 2026-10-12

- Filed from the visual QA sweep triage.
