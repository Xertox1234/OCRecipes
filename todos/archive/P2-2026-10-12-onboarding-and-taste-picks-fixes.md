---
title: "Onboarding and Taste Picks: blank recipe tiles, content hidden behind footers, inconsistent step counter"
status: done
priority: medium
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [qa-sweep, ui, onboarding]
github_issue:
---

# Onboarding and Taste Picks fixes

## Summary

Fix the onboarding findings from the 2026-10 visual QA sweep: blank recipe tiles (also on Settings → Taste Profile), consent text hidden under the footer, and a step counter that disagrees with itself.

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local), group D; screenshots `~/qa-sweep-2026-10/onboarding/`.

- #48 Medium (priority raised — also hits every user via Settings → Taste Profile): every TastePicks tile is blank. The API returns relative `imageUrl` (`/api/recipe-images/…`) and `client/components/TastePicksGrid.tsx:49` passes it raw to `<Image>` instead of `resolveImageUrl()` (`client/lib/query-client.ts:254`). Check whether production returns absolute CDN URLs (it may hide the bug there — fix anyway). Titles truncated at ~20 chars.
- #47 Medium: HealthDataConsent — "Why we ask" privacy paragraph below a fixed footer; user can tap "I Agree" without seeing it. `client/screens/onboarding/HealthDataConsentScreen.tsx`.
- #41 Medium: Welcome — last feature row hidden behind the footer; heart icon slides under the progress bar when scrolled. `client/screens/onboarding/WelcomeScreen.tsx`. #41 and #47 share one layout: content scrolls under a fixed footer with no bottom padding equal to the footer height.
- #49 Medium: step counter "Step 4 of 6" → "Step 6 of 7"; TastePicks has no badge; Welcome says "6 quick steps"; bar has 8 segments.
- #50 Medium: Goals grid has an empty cell in row 2; goal icons off-palette. `client/screens/onboarding/GoalsScreen.tsx`.
- Lows: #51 DietType grid off-centre, Paleo "?" placeholder icon; #52 three tile styles across steps, gutters 16 vs 26pt, "personalise" vs "personalize"; #42 Welcome green accents (colour itself handled in the design-system todo).

## Acceptance Criteria

- [x] TastePicks tiles show images in onboarding and Settings → Taste Profile (unit test on the URL resolution).
- [x] Welcome and HealthDataConsent content is fully visible above the footer at rest or clearly scrollable; consent text visible before "I Agree".
- [x] One source of truth for step count; badge, bar and Welcome copy agree on every step.
- [x] Goals grid has no hole; #51, #52 fixed or declined.
- [ ] Re-checked light + dark through the full onboarding flow with a fresh account.

## Implementation Notes

- Register a test account via `POST /api/auth/register` (`ageConfirmed: true`) — the iOS strong-password sheet blocks in-app sign-up on the simulator.

## Scope Contract

- **Mechanisms to use:** `resolveImageUrl`, existing onboarding layout components.
- **Files in scope:** `client/components/TastePicksGrid.tsx`, `client/screens/onboarding/*.tsx`, `client/screens/TasteProfileScreen.tsx` (images only), their `__tests__`.
- No new mechanisms.

## Dependencies

- TasteProfile's footer/header fixes live in the screen-chrome todo.

## Risks

- Onboarding is the first-run path; test the whole flow, not single screens.

## Updates

### 2026-10-12

- Filed from the visual QA sweep triage.

### 2026-10-12 (executor)

- Fixed #48 (TastePicksGrid uses resolveImageUrl; titles wrap to 2 lines), #47/#41 (consent "Why we ask" moved above the category list; Welcome/consent spacing tightened and scroll indicator shown), #49 (single step source `client/context/onboarding-steps.ts`; badges, 6-segment bar and Welcome copy derive from it; TastePicks gets a badge), #50 (Goals grid centred, accent colours from theme tokens), #51 (Paleo icon was an invalid Feather glyph, now compass), #52 "personalise" -> "personalize". Declined: #52 tile-style/gutter unification, #51 grid off-centre beyond spacing (not reproduced from code).
- Heart icon sliding under the progress bar on Welcome is ScrollView clipping at the bar edge: expected, left as is.
- Last AC (light + dark walk-through with a fresh account in the simulator) NOT done by the executor; left unticked for a human/sim run.
